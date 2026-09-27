use aura::{
    Aura, CandidateOutcomeVerdict, OutcomeEvaluationEvidence, OutcomeKind, OutcomeReceiptDraft,
    PurgeScope,
};

fn store_candidate(aura: &Aura, content: &str) -> String {
    aura.store(
        content,
        None,
        Some(vec!["receipt-candidate".to_string()]),
        Some(false),
        Some("text"),
        Some("recorded"),
        None,
        Some(false),
        None,
        Some("receipt-test"),
        Some("fact"),
    )
    .unwrap()
    .id
}

fn draft(candidates: &[String]) -> OutcomeReceiptDraft {
    OutcomeReceiptDraft::new(
        "task-1",
        "lineage-1",
        "attempt-1",
        candidates.to_vec(),
        vec![candidates[0].clone()],
        OutcomeKind::Helpful,
        None,
        "receipt-test",
        vec!["host:integration-test".to_string()],
    )
}

#[test]
fn observational_receipt_is_idempotent_and_does_not_change_recall() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let aura = Aura::open(path).unwrap();
    let candidates = vec![
        store_candidate(&aura, "alpha deployment rollback"),
        store_candidate(&aura, "alpha deployment verification"),
    ];
    let namespaces = ["receipt-test"];
    let before: Vec<String> = aura
        .recall_structured(
            "alpha deployment",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&namespaces),
        )
        .unwrap()
        .into_iter()
        .map(|(_, record)| record.id)
        .collect();

    let first = aura.capture_outcome_receipt(draft(&candidates)).unwrap();
    let duplicate = aura.capture_outcome_receipt(draft(&candidates)).unwrap();
    assert_eq!(duplicate.receipt_id, first.receipt_id);
    assert_eq!(first.schema_version, 1);
    assert_eq!(aura.outcome_receipts(None, None).unwrap().len(), 1);

    let mut conflict = draft(&candidates);
    conflict.outcome = OutcomeKind::Unhelpful;
    assert!(aura.capture_outcome_receipt(conflict).is_err());

    let after: Vec<String> = aura
        .recall_structured(
            "alpha deployment",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&namespaces),
        )
        .unwrap()
        .into_iter()
        .map(|(_, record)| record.id)
        .collect();
    assert_eq!(before, after);
    assert_eq!(
        aura.search(
            None,
            None,
            None,
            Some(10),
            None,
            None,
            Some(&namespaces),
            None,
        )
        .len(),
        2
    );

    aura.flush().unwrap();
    drop(aura);
    let reopened = Aura::open(path).unwrap();
    let receipts = reopened
        .outcome_receipts(Some("receipt-test"), Some("lineage-1"))
        .unwrap();
    assert_eq!(receipts.len(), 1);
    receipts[0].verify_integrity().unwrap();
}

#[test]
fn history_purge_removes_receipts_referencing_the_record() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Aura::open(dir.path().to_str().unwrap()).unwrap();
    let candidates = vec![
        store_candidate(&aura, "candidate to purge"),
        store_candidate(&aura, "candidate to retain"),
    ];
    aura.capture_outcome_receipt(draft(&candidates)).unwrap();
    assert_eq!(aura.outcome_receipts(None, None).unwrap().len(), 1);

    let purge = aura
        .purge_record(&candidates[0], PurgeScope::History)
        .unwrap();
    assert!(purge.audit_entries_removed >= 1);
    assert!(aura.outcome_receipts(None, None).unwrap().is_empty());
    assert!(aura.get(&candidates[1]).is_some());
}

#[test]
fn tampered_receipt_is_rejected_on_read() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let aura = Aura::open(path).unwrap();
    let candidates = vec![
        store_candidate(&aura, "tamper candidate one"),
        store_candidate(&aura, "tamper candidate two"),
    ];
    aura.capture_outcome_receipt(draft(&candidates)).unwrap();
    aura.flush().unwrap();
    drop(aura);

    let audit_path = dir.path().join("brain.audit");
    let lines = std::fs::read_to_string(&audit_path).unwrap();
    let tampered = lines
        .lines()
        .map(|line| {
            if line.contains("\"outcome_receipt\"") {
                line.replacen(&candidates[0], "ffffffffffff", 1)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&audit_path, format!("{tampered}\n")).unwrap();

    let reopened = Aura::open(path).unwrap();
    assert!(reopened.outcome_receipts(None, None).is_err());
}

#[test]
fn candidate_namespace_and_selection_are_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Aura::open(dir.path().to_str().unwrap()).unwrap();
    let candidate = store_candidate(&aura, "namespace candidate");

    let mut wrong_namespace = draft(std::slice::from_ref(&candidate));
    wrong_namespace.namespace = "another-namespace".to_string();
    assert!(aura.capture_outcome_receipt(wrong_namespace).is_err());

    let mut invalid_selection = draft(std::slice::from_ref(&candidate));
    invalid_selection.selected_record_ids = vec!["not-a-candidate".to_string()];
    assert!(aura.capture_outcome_receipt(invalid_selection).is_err());
}

#[test]
fn evaluation_evidence_is_durable_idempotent_and_observational() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let aura = Aura::open(path).unwrap();
    let candidates = vec![
        store_candidate(&aura, "evaluated candidate one"),
        store_candidate(&aura, "evaluated candidate two"),
    ];
    let evidence = OutcomeEvaluationEvidence {
        logging_policy_id: Some("policy:bounded-exploration-v1".to_string()),
        selected_set_probability_bps: Some(2500),
        candidate_verdicts: vec![
            CandidateOutcomeVerdict::new(candidates[0].clone(), OutcomeKind::Helpful),
            CandidateOutcomeVerdict::new(candidates[1].clone(), OutcomeKind::Unhelpful),
        ],
        verifier_id: Some("verifier:terminal-harness-v1".to_string()),
    };
    let evaluated = || draft(&candidates).with_evaluation(evidence.clone());

    let namespaces = ["receipt-test"];
    let before = aura
        .recall(
            "evaluated candidate",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&namespaces),
        )
        .unwrap();
    let first = aura.capture_outcome_receipt(evaluated()).unwrap();
    let duplicate = aura.capture_outcome_receipt(evaluated()).unwrap();
    assert_eq!(first.receipt_id, duplicate.receipt_id);
    assert_eq!(first.schema_version, 2);
    assert_eq!(first.selected_set_probability_bps, Some(2500));
    assert_eq!(first.candidate_verdicts, evidence.candidate_verdicts);
    first.verify_integrity().unwrap();
    let after = aura
        .recall(
            "evaluated candidate",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&namespaces),
        )
        .unwrap();
    assert_eq!(before, after);

    let mut conflicting = evaluated();
    conflicting
        .evaluation
        .as_mut()
        .unwrap()
        .selected_set_probability_bps = Some(5000);
    assert!(aura.capture_outcome_receipt(conflicting).is_err());

    aura.flush().unwrap();
    drop(aura);
    let reopened = Aura::open(path).unwrap();
    let receipts = reopened
        .outcome_receipts(Some("receipt-test"), Some("lineage-1"))
        .unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].schema_version, 2);
    assert_eq!(
        receipts[0].verifier_id.as_deref(),
        Some("verifier:terminal-harness-v1")
    );
    receipts[0].verify_integrity().unwrap();
}
