//! Splits the receiver's byte stream into NMEA sentences and UBX frames.
//!
//! Both arrive interleaved on the same port (UBX ACKs answer our configuration). Bytes
//! that start neither are skipped; a frame that is too long or fails its checksum is
//! dropped and the search restarts after its first byte.

use super::ubx;

/// NMEA 0183 allows 82 characters; u-blox stays below this.
const MAX_SENTENCE: usize = 128;
/// Larger than anything a u-blox 6 sends unprompted.
const MAX_UBX_PAYLOAD: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// Without the line ending; the NMEA checksum is not checked here.
    Nmea(String),
    Ubx {
        class: u8,
        id: u8,
        payload: Vec<u8>,
    },
}

#[derive(Debug, Default)]
pub struct Framer {
    buf: Vec<u8>,
    /// UBX frames with a wrong checksum and over-long or non-ASCII sentences.
    pub errors: u64,
}

impl Framer {
    pub fn push(&mut self, bytes: &[u8], out: &mut Vec<Frame>) {
        self.buf.extend_from_slice(bytes);
        let mut pos = 0;
        while pos < self.buf.len() {
            match self.buf[pos] {
                b'$' => match self.nmea_at(pos) {
                    Some(Ok((frame, end))) => {
                        out.push(frame);
                        pos = end;
                    }
                    Some(Err(())) => {
                        self.errors += 1;
                        pos += 1;
                    }
                    None => break,
                },
                b if b == ubx::SYNC[0] => match self.ubx_at(pos) {
                    Some(Ok((frame, end))) => {
                        out.push(frame);
                        pos = end;
                    }
                    Some(Err(())) => pos += 1,
                    None => break,
                },
                _ => pos += 1,
            }
        }
        self.buf.drain(..pos);
    }

    /// `None` if the sentence is not complete yet.
    fn nmea_at(&self, start: usize) -> Option<Result<(Frame, usize), ()>> {
        let rest = &self.buf[start..];
        let Some(nl) = rest.iter().position(|&b| b == b'\n') else {
            return (rest.len() > MAX_SENTENCE).then_some(Err(()));
        };
        let line = &rest[..nl];
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.len() > MAX_SENTENCE || !line.is_ascii() {
            return Some(Err(()));
        }
        let text = String::from_utf8_lossy(line).into_owned();
        Some(Ok((Frame::Nmea(text), start + nl + 1)))
    }

    fn ubx_at(&mut self, start: usize) -> Option<Result<(Frame, usize), ()>> {
        let rest = &self.buf[start..];
        if rest.len() < 2 {
            return None;
        }
        if rest[1] != ubx::SYNC[1] {
            return Some(Err(()));
        }
        if rest.len() < 6 {
            return None;
        }
        let len = u16::from_le_bytes([rest[4], rest[5]]) as usize;
        if len > MAX_UBX_PAYLOAD {
            self.errors += 1;
            return Some(Err(()));
        }
        let total = 6 + len + 2;
        if rest.len() < total {
            return None;
        }
        if ubx::checksum(&rest[2..6 + len]) != [rest[6 + len], rest[7 + len]] {
            self.errors += 1;
            return Some(Err(()));
        }
        let frame = Frame::Ubx {
            class: rest[2],
            id: rest[3],
            payload: rest[6..6 + len].to_vec(),
        };
        Some(Ok((frame, start + total)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(chunks: &[&[u8]]) -> (Vec<Frame>, u64) {
        let mut f = Framer::default();
        let mut out = Vec::new();
        for c in chunks {
            f.push(c, &mut out);
        }
        (out, f.errors)
    }

    #[test]
    fn interleaved_nmea_and_ubx_across_chunks() {
        let ack = ubx::frame(0x05, 0x01, &[0x06, 0x08]);
        let mut stream = b"\x00garbage$GPGSA,A,1,,,,,,,,,,,,,99.9,99.9,99.9*09\r\n".to_vec();
        stream.extend_from_slice(&ack);
        stream.extend_from_slice(b"$GPGSV,1,1,00*79\r\n$GPRMC,0");
        let (a, b) = stream.split_at(20);
        let (frames, errors) = split(&[a, b]);
        assert_eq!(errors, 0);
        assert_eq!(
            frames,
            [
                Frame::Nmea("$GPGSA,A,1,,,,,,,,,,,,,99.9,99.9,99.9*09".into()),
                Frame::Ubx {
                    class: 0x05,
                    id: 0x01,
                    payload: vec![0x06, 0x08]
                },
                Frame::Nmea("$GPGSV,1,1,00*79".into()),
            ]
        );
    }

    #[test]
    fn bad_ubx_checksum_is_counted_and_skipped() {
        let mut ack = ubx::frame(0x05, 0x01, &[0x06, 0x08]);
        *ack.last_mut().unwrap() ^= 0xFF;
        ack.extend_from_slice(b"$GPGSV,1,1,00*79\r\n");
        let (frames, errors) = split(&[&ack]);
        assert_eq!(errors, 1);
        assert_eq!(frames, [Frame::Nmea("$GPGSV,1,1,00*79".into())]);
    }

    #[test]
    fn runaway_sentence_does_not_grow_the_buffer() {
        let mut f = Framer::default();
        let mut out = Vec::new();
        f.push(b"$", &mut out);
        f.push(&[b'A'; 500], &mut out);
        assert!(out.is_empty());
        assert!(f.buf.len() <= MAX_SENTENCE + 1);
    }
}
