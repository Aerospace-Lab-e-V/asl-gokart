use std::{fs, path::PathBuf, time::Duration};

use kart_agent::{
    config::Retention,
    log::{ACTIVE_SUFFIX, Segment, SessionInfo, enforce_retention},
};
use mcap::{MessageStream, read::Options};
use prost::Message;
use telemetry_schema::v1::{Batch, Sample};

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kart-agent-log-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn session() -> SessionInfo {
    SessionInfo {
        kart_id: "kart-test".into(),
        session_id: "s1".into(),
        boot_id: "b1".into(),
        agent_version: "test".into(),
        run: 1,
    }
}

fn batch(seq: u64) -> Vec<u8> {
    Batch {
        kart_id: "kart-test".into(),
        session_id: "s1".into(),
        seq,
        samples: vec![Sample {
            signal_id: 101,
            t_us: 1_700_000_000_000_000 + seq as i64,
            value: seq as f64,
        }],
    }
    .encode_to_vec()
}

/// Batches (not events) readable from a possibly unfinished file.
fn read_batches(path: &std::path::Path) -> Vec<Batch> {
    let bytes = fs::read(path).unwrap();
    MessageStream::new_with_options(&bytes, Options::IgnoreEndMagic.into())
        .unwrap()
        .map_while(Result::ok)
        .filter(|m| m.channel.message_encoding == "protobuf")
        .map(|m| Batch::decode(m.data.as_ref()).unwrap())
        .collect()
}

#[test]
fn unfinished_segment_is_readable_up_to_the_last_sync() {
    let d = dir("crash");
    let mut seg = Segment::create(&d, &session(), 0).unwrap();
    for seq in 0..10 {
        seg.write_batch(seq, seq * 1000, &batch(seq)).unwrap();
    }
    seg.write_event(5, br#"{"event":"test"}"#).unwrap();
    seg.sync().unwrap();
    for seq in 10..15 {
        seg.write_batch(seq, seq * 1000, &batch(seq)).unwrap();
    }
    // A crash: nothing after the sync is guaranteed, and no footer is written.
    std::mem::forget(seg);

    let active: Vec<_> = fs::read_dir(&d)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(active.len(), 1);
    assert!(active[0].to_string_lossy().ends_with(ACTIVE_SUFFIX));
    let seqs: Vec<u64> = read_batches(&active[0]).iter().map(|b| b.seq).collect();
    assert!(seqs.len() >= 10, "lost synced batches: {seqs:?}");
    assert_eq!(&seqs[..10], &(0..10).collect::<Vec<_>>()[..]);
}

#[test]
fn finished_segment_is_complete_and_renamed() {
    let d = dir("finish");
    let mut seg = Segment::create(&d, &session(), 42).unwrap();
    for seq in 42..50 {
        seg.write_batch(seq, seq, &batch(seq)).unwrap();
    }
    let path = seg.finish().unwrap();
    let name = path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with("seg-000000000042-") && name.ends_with(".mcap"),
        "{name}"
    );
    assert!(!name.ends_with(ACTIVE_SUFFIX));

    let bytes = fs::read(&path).unwrap();
    let summary = mcap::Summary::read(&bytes).unwrap().expect("a summary");
    assert_eq!(summary.stats.unwrap().message_count, 8);
    assert_eq!(read_batches(&path).len(), 8);
}

#[test]
fn retention_deletes_oldest_finished_segments_only() {
    let root = dir("retention");
    let (old, current) = (root.join("old-session"), root.join("s1"));
    fs::create_dir_all(&old).unwrap();
    fs::create_dir_all(&current).unwrap();
    let write = |dir: &PathBuf, name: &str| {
        fs::write(dir.join(name), vec![0u8; 1000]).unwrap();
        std::thread::sleep(Duration::from_millis(20)); // distinct mtimes
    };
    write(&old, "seg-000000000000-a.mcap");
    // Left behind by a crash of an earlier run: finished and counted, not deleted first.
    write(&old, "seg-000000000010-b.mcap.active");
    write(&current, "seg-000000000020-c.mcap");
    write(&current, "seg-000000000030-d.mcap.active");

    let usage = enforce_retention(
        &root,
        &current,
        &Retention {
            max_bytes: 2500,
            min_free_bytes: 0,
        },
    )
    .unwrap();
    // 4000 bytes → delete the two oldest finished ones; the active one stays.
    assert_eq!(usage.total_bytes, 2000);
    assert!(!old.exists(), "empty old session directory removed");
    assert!(current.join("seg-000000000020-c.mcap").exists());
    assert!(current.join("seg-000000000030-d.mcap.active").exists());
    assert_eq!(usage.segments, 2);
}
