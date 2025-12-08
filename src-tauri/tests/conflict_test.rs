use korppi::conflict_detector::ConflictDetector;
use korppi::patch_log::Patch;
use serde_json::json;
use korppi::models::ConflictType;

#[test]
fn test_overlapping_edit_detection() {
    let detector = ConflictDetector::new(5000);

    let patches = vec![
        Patch {
            id: 1,
            timestamp: 1000,
            author: "alice".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "replace_text",
                "range": [10, 20],
                "deletedText": "old text",
                "insertedText": "alice's edit"
            }]),
            review_status: "pending".to_string(),
        },
        Patch {
            id: 2,
            timestamp: 1500, // Within 5s window
            author: "bob".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "replace_text",
                "range": [15, 25],
                "deletedText": "xt here",
                "insertedText": "bob's edit"
            }]),
            review_status: "pending".to_string(),
        },
    ];

    let conflicts = detector.detect_conflicts(&patches);

    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].local_version.author, "alice");
    assert_eq!(conflicts[0].remote_version.author, "bob");
}

#[test]
fn test_no_conflict_different_regions() {
    let detector = ConflictDetector::new(5000);

    let patches = vec![
        Patch {
            id: 1,
            timestamp: 1000,
            author: "alice".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "insert_text",
                "at": 10,
                "insertedText": "hello"
            }]),
            review_status: "pending".to_string(),
        },
        Patch {
            id: 2,
            timestamp: 1500,
            author: "bob".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "insert_text",
                "at": 100, // Different position
                "insertedText": "world"
            }]),
            review_status: "pending".to_string(),
        },
    ];

    let conflicts = detector.detect_conflicts(&patches);

    assert_eq!(conflicts.len(), 0);
}

#[test]
fn test_concurrent_insert_same_position() {
    let detector = ConflictDetector::new(5000);

    let patches = vec![
        Patch {
            id: 1,
            timestamp: 1000,
            author: "alice".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "insert_text",
                "at": 50,
                "insertedText": "alice first"
            }]),
            review_status: "pending".to_string(),
        },
        Patch {
            id: 2,
            timestamp: 1200,
            author: "bob".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "insert_text",
                "at": 50, // Same position!
                "insertedText": "bob first"
            }]),
            review_status: "pending".to_string(),
        },
    ];

    let conflicts = detector.detect_conflicts(&patches);

    assert_eq!(conflicts.len(), 1);
    match conflicts[0].conflict_type {
        ConflictType::ConcurrentInsert => {}
        _ => panic!("Expected ConcurrentInsert conflict type"),
    }
}
