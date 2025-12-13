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
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
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
            uuid: Some("uuid-2".to_string()),
            parent_uuid: None,
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
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
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
            uuid: Some("uuid-2".to_string()),
            parent_uuid: None,
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
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
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
            uuid: Some("uuid-2".to_string()),
            parent_uuid: None,
        },
    ];

    let conflicts = detector.detect_conflicts(&patches);

    assert_eq!(conflicts.len(), 1);
    match conflicts[0].conflict_type {
        ConflictType::ConcurrentInsert => {}
        _ => panic!("Expected ConcurrentInsert conflict type"),
    }
}

#[test]
fn test_empty_patches_no_conflict() {
    let detector = ConflictDetector::new(5000);
    let patches: Vec<Patch> = vec![];
    let conflicts = detector.detect_conflicts(&patches);
    assert_eq!(conflicts.len(), 0, "Empty patch list should have no conflicts");
}

#[test]
fn test_single_patch_no_conflict() {
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
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
        },
    ];
    let conflicts = detector.detect_conflicts(&patches);
    assert_eq!(conflicts.len(), 0, "Single patch should have no conflicts");
}

#[test]
fn test_same_author_no_conflict() {
    let detector = ConflictDetector::new(5000);
    
    // Same author making overlapping edits within time window - should NOT conflict
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
                "insertedText": "first edit"
            }]),
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
        },
        Patch {
            id: 2,
            timestamp: 1500,
            author: "alice".to_string(), // Same author
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "replace_text",
                "range": [15, 25], // Overlapping range
                "deletedText": "some text",
                "insertedText": "second edit"
            }]),
            uuid: Some("uuid-2".to_string()),
            parent_uuid: None,
        },
    ];
    
    let conflicts = detector.detect_conflicts(&patches);
    assert_eq!(conflicts.len(), 0, "Same author edits should not conflict");
}

#[test]
fn test_outside_time_window_no_conflict() {
    let detector = ConflictDetector::new(5000); // 5 second window
    
    // Different authors editing same region but far apart in time
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
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
        },
        Patch {
            id: 2,
            timestamp: 10000, // 9 seconds later - outside 5s window
            author: "bob".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "replace_text",
                "range": [15, 25],
                "deletedText": "xt here",
                "insertedText": "bob's edit"
            }]),
            uuid: Some("uuid-2".to_string()),
            parent_uuid: None,
        },
    ];
    
    let conflicts = detector.detect_conflicts(&patches);
    assert_eq!(conflicts.len(), 0, "Patches outside time window should not conflict");
}

#[test]
fn test_delete_modify_conflict() {
    let detector = ConflictDetector::new(5000);
    
    let patches = vec![
        Patch {
            id: 1,
            timestamp: 1000,
            author: "alice".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "delete_text",
                "range": [10, 30],
                "deletedText": "text to be deleted"
            }]),
            uuid: Some("uuid-1".to_string()),
            parent_uuid: None,
        },
        Patch {
            id: 2,
            timestamp: 1500,
            author: "bob".to_string(),
            kind: "semantic_group".to_string(),
            data: json!([{
                "kind": "replace_text",
                "range": [15, 25], // Overlaps with deleted region
                "deletedText": "old",
                "insertedText": "modified"
            }]),
            uuid: Some("uuid-2".to_string()),
            parent_uuid: None,
        },
    ];
    
    let conflicts = detector.detect_conflicts(&patches);
    
    assert_eq!(conflicts.len(), 1, "Delete and modify in same region should conflict");
    match conflicts[0].conflict_type {
        ConflictType::DeleteModify => {}
        _ => panic!("Expected DeleteModify conflict type, got {:?}", conflicts[0].conflict_type),
    }
}
