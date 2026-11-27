//! The device CA: one key and self-signed certificate in a directory that only the
//! service can read (`ca.key`, `ca.pem`). It signs device client certificates and nothing
//! else; the border Nginx trusts `ca.pem` for `/mqtt`.

use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
};

use anyhow::{Context, Result, bail};
use rcgen::{
    BasicConstraints, CertificateParams, CertificateSigningRequestParams, DistinguishedName,
    DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose, SerialNumber,
};
use time::{Duration, OffsetDateTime};

pub const KEY_FILE: &str = "ca.key";
pub const CERT_FILE: &str = "ca.pem";
const CA_NAME: &str = "ASL Kart Device CA";
const CA_YEARS: i64 = 10;

pub struct DeviceCa {
    issuer: Issuer<'static, KeyPair>,
    pub cert_pem: String,
}

/// A signed device certificate.
pub struct Signed {
    pub pem: String,
    pub serial_hex: String,
    pub not_after: OffsetDateTime,
}

/// Creates the CA in `dir`. Refuses to overwrite an existing one: every device certificate
/// depends on it.
pub fn init(dir: &Path) -> Result<String> {
    let (key_path, cert_path) = (dir.join(KEY_FILE), dir.join(CERT_FILE));
    if key_path.exists() || cert_path.exists() {
        bail!(
            "{} already holds a CA; remove it first only if every device should be re-enrolled",
            dir.display()
        );
    }
    fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let key = KeyPair::generate().context("generating the CA key")?;
    let mut params = CertificateParams::default();
    params.distinguished_name = DistinguishedName::new();
    params.distinguished_name.push(DnType::CommonName, CA_NAME);
    params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    let now = OffsetDateTime::now_utc();
    params.not_before = now - Duration::hours(1);
    params.not_after = now + Duration::days(365 * CA_YEARS);
    params.serial_number = Some(random_serial()?);
    let cert = params
        .self_signed(&key)
        .context("signing the CA certificate")?;

    write_private(&key_path, key.serialize_pem().as_bytes())?;
    fs::write(&cert_path, cert.pem())?;
    fs::set_permissions(&cert_path, fs::Permissions::from_mode(0o644))?;
    Ok(cert.pem())
}

impl DeviceCa {
    pub fn load(dir: &Path) -> Result<Self> {
        let key_path = dir.join(KEY_FILE);
        let cert_path = dir.join(CERT_FILE);
        let key_pem = fs::read_to_string(&key_path).with_context(|| {
            format!(
                "reading {} (create it with `enroll init-ca`)",
                key_path.display()
            )
        })?;
        let cert_pem = fs::read_to_string(&cert_path)
            .with_context(|| format!("reading {}", cert_path.display()))?;
        let key = KeyPair::from_pem(&key_pem).context("parsing the CA key")?;
        let issuer =
            Issuer::from_ca_cert_pem(&cert_pem, key).context("parsing the CA certificate")?;
        Ok(Self { issuer, cert_pem })
    }

    /// Signs the CSR's public key for `common_name`. Only the key is taken from the CSR
    /// (its signature is checked when parsing); subject and extensions are ours.
    pub fn sign(
        &self,
        csr: &CertificateSigningRequestParams,
        common_name: &str,
        days: i64,
    ) -> Result<Signed> {
        let mut params = CertificateParams::default();
        params.distinguished_name = DistinguishedName::new();
        params
            .distinguished_name
            .push(DnType::CommonName, common_name);
        params.is_ca = IsCa::ExplicitNoCa;
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        params.use_authority_key_identifier_extension = true;
        let now = OffsetDateTime::now_utc();
        // Some slack for devices whose clock is a little behind.
        params.not_before = now - Duration::hours(1);
        params.not_after = now + Duration::days(days);
        let serial = random_serial()?;
        let serial_hex = hex(&serial.to_bytes());
        params.serial_number = Some(serial);
        let cert = params
            .signed_by(&csr.public_key, &self.issuer)
            .context("signing the device certificate")?;
        Ok(Signed {
            pem: cert.pem(),
            serial_hex,
            not_after: params.not_after,
        })
    }
}

/// Parses a CSR and checks its signature (proof that the requester holds the key).
pub fn parse_csr(pem: &str) -> Result<CertificateSigningRequestParams> {
    CertificateSigningRequestParams::from_pem(pem).map_err(|e| anyhow::anyhow!("invalid CSR: {e}"))
}

fn random_serial() -> Result<SerialNumber> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("random: {e}"))?;
    bytes[0] &= 0x7f; // positive
    Ok(SerialNumber::from_slice(&bytes))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .with_context(|| format!("creating {}", path.display()))?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::PublicKeyData;
    use x509_parser::prelude::{FromDer, X509Certificate};

    #[test]
    fn signs_only_the_key_with_our_subject() {
        let dir = std::env::temp_dir().join(format!("enroll-ca-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        init(&dir).unwrap();
        assert!(init(&dir).is_err(), "must not overwrite a CA");
        let ca = DeviceCa::load(&dir).unwrap();

        let device_key = KeyPair::generate().unwrap();
        let mut req = CertificateParams::default();
        req.distinguished_name.push(DnType::CommonName, "ingest");
        req.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        let csr = req.serialize_request(&device_key).unwrap().pem().unwrap();

        let signed = ca.sign(&parse_csr(&csr).unwrap(), "kart-03", 365).unwrap();
        let der = ::pem::parse(&signed.pem).unwrap();
        let (_, cert) = X509Certificate::from_der(der.contents()).unwrap();
        let cn = cert
            .subject()
            .iter_common_name()
            .next()
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(cn, "kart-03");
        assert!(!cert.is_ca());
        let eku = cert.extended_key_usage().unwrap().unwrap().value;
        assert!(eku.client_auth && !eku.server_auth);
        assert_eq!(
            &cert.public_key().subject_public_key.data[..],
            device_key.der_bytes()
        );

        let ca_der = ::pem::parse(&ca.cert_pem).unwrap();
        let (_, ca_cert) = X509Certificate::from_der(ca_der.contents()).unwrap();
        cert.verify_signature(Some(ca_cert.public_key())).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_a_tampered_csr() {
        let key = KeyPair::generate().unwrap();
        let other = KeyPair::generate().unwrap();
        let csr = CertificateParams::default()
            .serialize_request(&key)
            .unwrap();
        // Same request, signed with a key that does not match its public key.
        let mut der = csr.der().to_vec();
        let forged = CertificateParams::default()
            .serialize_request(&other)
            .unwrap();
        let n = der.len();
        der[n - 8..].copy_from_slice(&forged.der()[forged.der().len() - 8..]);
        let pem = ::pem::encode(&::pem::Pem::new("CERTIFICATE REQUEST", der));
        assert!(parse_csr(&pem).is_err());
    }
}
