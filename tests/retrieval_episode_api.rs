use aura::{
    AnswerPermission, Aura, CitationLockDecision, EvidenceClaim, Level, MemoryRoute,
    SourceDocument, SourceSpan, VerificationStatus,
};

fn claim_for(record_id: &str, bytes: &[u8]) -> anyhow::Result<(SourceDocument, EvidenceClaim)> {
    let document = SourceDocument::from_bytes(
        format!("doc-{record_id}"),
        "rev-1",
        format!("memory://{record_id}"),
        bytes,
    );
    let span = SourceSpan::from_document(&document, bytes, 0, bytes.len())?;
    Ok((
        document,
        EvidenceClaim {
            claim_id: format!("claim-{record_id}"),
            record_id: record_id.to_string(),
            claim_text: String::from_utf8_lossy(bytes).into_owned(),
            lineage: span,
            verification_status: VerificationStatus::Verified,
            answer_permission: AnswerPermission::Cite,
            confidence: 0.99,
            supporting_lineage_groups: Vec::new(),
            conflicting_claim_ids: Vec::new(),
            evidence_debt: Vec::new(),
        },
    ))
}

#[test]
fn aura_episode_allows_only_opened_supported_evidence_without_activation() -> anyhow::Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(directory.path().to_str().unwrap())?;
    let record = aura.memory_api().store(
        "The current launch date is September 24.",
        Some(Level::Domain),
        None,
        Some(false),
        Some("text/plain"),
        Some("recorded"),
        None,
        Some(false),
        None,
        Some("citation-test"),
        Some("fact"),
    )?;
    let activation_before = aura.get(&record.id).unwrap().last_activated;

    let mut episode = aura.start_retrieval_episode(
        "What is the current launch date?",
        vec![record.id.clone()],
        Some(vec![MemoryRoute::Timeline]),
    )?;
    let bytes = b"The current launch date is September 24.";
    let (document, claim) = claim_for(&record.id, bytes)?;
    let opened = episode.open_evidence(
        &claim,
        &document,
        bytes,
        MemoryRoute::Timeline,
        vec!["launch-date".into()],
    )?;
    assert!(opened.citable);

    let allowed = episode.finalize(true, &[record.id.clone()], &["launch-date".into()]);
    assert_eq!(allowed.decision, CitationLockDecision::Allow);
    assert!(allowed.answer_permitted);

    let partial = episode.finalize(
        true,
        &[record.id.clone()],
        &["launch-date".into(), "launch-owner".into()],
    );
    assert_eq!(partial.decision, CitationLockDecision::Block);
    assert_eq!(partial.unsupported_claim_keys, vec!["launch-owner"]);
    assert_eq!(
        aura.get(&record.id).unwrap().last_activated,
        activation_before
    );
    Ok(())
}

#[test]
fn facade_routes_and_rejects_unknown_candidate_ids() -> anyhow::Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(directory.path().to_str().unwrap())?;
    let intent = aura
        .memory_api()
        .suggest_memory_intent("Which project changed its launch date?");
    assert_eq!(
        intent.suggested_routes,
        vec![MemoryRoute::Timeline, MemoryRoute::Graph]
    );

    assert!(aura
        .memory_api()
        .start_retrieval_episode("question", vec!["missing".into()], None)
        .is_err());
    Ok(())
}
