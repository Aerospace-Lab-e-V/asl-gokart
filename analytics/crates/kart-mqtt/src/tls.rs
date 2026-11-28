//! TLS for `wss://` (and the enrollment requests): ring as the crypto provider, so no
//! aws-lc C code has to be cross-compiled with cargo zigbuild; the public roots bundled
//! with the binary (the border Nginx has a public wildcard certificate), plus optionally
//! one extra CA for tests or a private proxy.

use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use rustls::{
    ClientConfig, RootCertStore,
    crypto::CryptoProvider,
    pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
};

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn roots(extra_ca_pem: Option<&str>) -> Result<RootCertStore> {
    let mut roots = RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    if let Some(pem) = extra_ca_pem {
        for cert in CertificateDer::pem_slice_iter(pem.as_bytes()) {
            roots
                .add(cert.context("parsing the extra CA")?)
                .context("adding the extra CA")?;
        }
    }
    Ok(roots)
}

/// Server authentication only (enrollment requests).
pub fn server_config(extra_ca_pem: Option<&str>) -> Result<ClientConfig> {
    Ok(ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()?
        .with_root_certificates(roots(extra_ca_pem)?)
        .with_no_client_auth())
}

/// Server authentication plus the device's client certificate (`wss://`).
pub fn client_config(
    cert_pem: &str,
    key_pem: &str,
    extra_ca_pem: Option<&str>,
) -> Result<Arc<ClientConfig>> {
    let chain = CertificateDer::pem_slice_iter(cert_pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()
        .context("parsing the client certificate")?;
    if chain.is_empty() {
        return Err(anyhow!("no client certificate in the PEM"));
    }
    let key =
        PrivateKeyDer::from_pem_slice(key_pem.as_bytes()).context("parsing the client key")?;
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()?
        .with_root_certificates(roots(extra_ca_pem)?)
        .with_client_auth_cert(chain, key)
        .context("the client certificate does not match its key")?;
    Ok(Arc::new(config))
}
