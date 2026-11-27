//! Client for Mosquitto's dynamic security plugin: commands go as JSON to
//! `$CONTROL/dynamic-security/v1`, answers come back on `.../response` with the same
//! `correlationData`. Requires a user with the plugin's admin role (`dynsec-admin`,
//! created by `deploy/mosquitto/start.sh`).

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{oneshot, watch};
use tracing::{info, warn};

const TOPIC: &str = "$CONTROL/dynamic-security/v1";
const RESPONSE_TOPIC: &str = "$CONTROL/dynamic-security/v1/response";
const TIMEOUT: Duration = Duration::from_secs(5);

/// A plugin error such as "Client not found".
#[derive(Debug)]
pub struct CommandError(pub String);

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CommandError {}

/// Is `e` the plugin saying that something does not exist?
pub fn is_not_found(e: &anyhow::Error) -> bool {
    e.downcast_ref::<CommandError>()
        .is_some_and(|c| c.0.ends_with("not found"))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Acl {
    pub acltype: String,
    pub topic: String,
    pub allow: bool,
    #[serde(default)]
    pub priority: i64,
}

impl Acl {
    pub fn allow(acltype: &str, topic: impl Into<String>) -> Self {
        Self {
            acltype: acltype.into(),
            topic: topic.into(),
            allow: true,
            priority: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoleRef {
    pub rolename: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Client {
    pub username: String,
    #[serde(default)]
    pub clientid: Option<String>,
    #[serde(default)]
    pub textname: Option<String>,
    #[serde(default)]
    pub roles: Vec<RoleRef>,
    #[serde(default)]
    pub disabled: bool,
}

type Waiters = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

#[derive(Clone)]
pub struct Dynsec {
    client: AsyncClient,
    waiters: Waiters,
    next_id: Arc<AtomicU64>,
    ready: watch::Receiver<bool>,
}

impl Dynsec {
    /// Connects (and keeps reconnecting) as the plugin's admin user. Must be called inside
    /// a Tokio runtime.
    pub fn connect(url: &str, client_id: &str, username: &str, password: &str) -> Result<Self> {
        let mut opts = MqttOptions::parse_url(format!("{url}?client_id={client_id}"))
            .context("parsing the broker URL")?;
        opts.set_credentials(username, password);
        opts.set_keep_alive(Duration::from_secs(10));
        let (client, mut eventloop) = AsyncClient::new(opts, 32);
        let waiters: Waiters = Arc::default();
        let (ready_tx, ready) = watch::channel(false);

        let (c, w) = (client.clone(), waiters.clone());
        tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        info!("connected to the broker");
                        let _ = c.subscribe(RESPONSE_TOPIC, QoS::AtLeastOnce).await;
                    }
                    Ok(Event::Incoming(Packet::SubAck(_))) => {
                        let _ = ready_tx.send(true);
                    }
                    Ok(Event::Incoming(Packet::Publish(p))) if p.topic == RESPONSE_TOPIC => {
                        deliver(&w, &p.payload);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        let _ = ready_tx.send(false);
                        warn!("broker connection: {e}; retrying in 2s");
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        });
        Ok(Self {
            client,
            waiters,
            next_id: Arc::default(),
            ready,
        })
    }

    /// Waits until the response subscription is in place.
    pub async fn wait_ready(&self, timeout: Duration) -> Result<()> {
        let mut ready = self.ready.clone();
        tokio::time::timeout(timeout, ready.wait_for(|&r| r))
            .await
            .map_err(|_| anyhow!("broker not reachable within {timeout:?}"))?
            .map_err(|_| anyhow!("broker connection task ended"))?;
        Ok(())
    }

    /// Sends one command and returns its `data` (or `Null`). Plugin errors become
    /// [`CommandError`].
    pub async fn command(&self, mut cmd: Value) -> Result<Value> {
        self.wait_ready(TIMEOUT).await?;
        let id = format!("enroll-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        cmd["correlationData"] = json!(id);
        let name = cmd["command"].as_str().unwrap_or("?").to_owned();
        let (tx, rx) = oneshot::channel();
        self.waiters.lock().expect("waiters").insert(id.clone(), tx);
        let body = serde_json::to_vec(&json!({ "commands": [cmd] }))?;
        if let Err(e) = self
            .client
            .publish(TOPIC, QoS::AtLeastOnce, false, body)
            .await
        {
            self.waiters.lock().expect("waiters").remove(&id);
            bail!("sending {name}: {e}");
        }
        let response = match tokio::time::timeout(TIMEOUT, rx).await {
            Ok(Ok(r)) => r,
            _ => {
                self.waiters.lock().expect("waiters").remove(&id);
                bail!("{name}: no answer from the broker");
            }
        };
        if let Some(err) = response.get("error").and_then(Value::as_str) {
            return Err(CommandError(err.to_owned())).with_context(|| name.clone());
        }
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    }

    async fn run(&self, cmd: Value) -> Result<()> {
        self.command(cmd).await.map(|_| ())
    }

    pub async fn get_client(&self, username: &str) -> Result<Option<Client>> {
        match self
            .command(json!({ "command": "getClient", "username": username }))
            .await
        {
            Ok(data) => Ok(Some(serde_json::from_value(data["client"].clone())?)),
            Err(e) if is_not_found(&e) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn list_clients(&self) -> Result<Vec<Client>> {
        let data = self
            .command(json!({ "command": "listClients", "verbose": true }))
            .await?;
        Ok(serde_json::from_value(data["clients"].clone())?)
    }

    /// Creates the role or brings its ACLs to exactly `acls`.
    pub async fn ensure_role(&self, rolename: &str, acls: &[Acl]) -> Result<()> {
        let existing = match self
            .command(json!({ "command": "getRole", "rolename": rolename }))
            .await
        {
            Ok(data) => {
                serde_json::from_value::<Vec<Acl>>(data["role"]["acls"].clone()).unwrap_or_default()
            }
            Err(e) if is_not_found(&e) => {
                return self
                    .run(json!({ "command": "createRole", "rolename": rolename, "acls": acls }))
                    .await;
            }
            Err(e) => return Err(e),
        };
        for acl in existing.iter().filter(|a| !acls.contains(a)) {
            self.run(json!({
                "command": "removeRoleACL", "rolename": rolename,
                "acltype": acl.acltype, "topic": acl.topic,
            }))
            .await?;
        }
        for acl in acls.iter().filter(|a| !existing.contains(a)) {
            self.run(json!({
                "command": "addRoleACL", "rolename": rolename, "acltype": acl.acltype,
                "topic": acl.topic, "allow": acl.allow, "priority": acl.priority,
            }))
            .await?;
        }
        Ok(())
    }

    /// Creates the client, or sets its password, client ID and roles and enables it.
    /// `clientid: None` lets the user connect with any client ID.
    pub async fn ensure_client(
        &self,
        username: &str,
        password: &str,
        clientid: Option<&str>,
        roles: &[&str],
        textname: &str,
    ) -> Result<()> {
        let Some(existing) = self.get_client(username).await? else {
            let roles: Vec<Value> = roles.iter().map(|r| json!({ "rolename": r })).collect();
            let mut cmd = json!({
                "command": "createClient", "username": username, "password": password,
                "textname": textname, "roles": roles,
            });
            if let Some(id) = clientid {
                cmd["clientid"] = json!(id);
            }
            return self.run(cmd).await;
        };
        self.run(
            json!({ "command": "setClientPassword", "username": username, "password": password }),
        )
        .await?;
        if existing.clientid.as_deref() != clientid {
            let mut cmd = json!({ "command": "setClientId", "username": username });
            if let Some(id) = clientid {
                cmd["clientid"] = json!(id);
            }
            self.run(cmd).await?;
        }
        for role in existing
            .roles
            .iter()
            .filter(|r| !roles.contains(&r.rolename.as_str()))
        {
            self.run(json!({ "command": "removeClientRole", "username": username, "rolename": role.rolename }))
                .await?;
        }
        for role in roles
            .iter()
            .filter(|r| !existing.roles.iter().any(|e| e.rolename == **r))
        {
            self.run(json!({ "command": "addClientRole", "username": username, "rolename": role }))
                .await?;
        }
        if existing.textname.as_deref() != Some(textname) {
            self.run(
                json!({ "command": "modifyClient", "username": username, "textname": textname }),
            )
            .await?;
        }
        if existing.disabled {
            self.set_enabled(username, true).await?;
        }
        Ok(())
    }

    pub async fn set_enabled(&self, username: &str, enabled: bool) -> Result<()> {
        let command = if enabled {
            "enableClient"
        } else {
            "disableClient"
        };
        self.run(json!({ "command": command, "username": username }))
            .await
    }
}

fn deliver(waiters: &Waiters, payload: &[u8]) {
    let Ok(body) = serde_json::from_slice::<Value>(payload) else {
        return;
    };
    let Some(responses) = body["responses"].as_array() else {
        return;
    };
    let mut waiters = waiters.lock().expect("waiters");
    for r in responses {
        if let Some(tx) = r["correlationData"]
            .as_str()
            .and_then(|id| waiters.remove(id))
        {
            let _ = tx.send(r.clone());
        }
    }
}
