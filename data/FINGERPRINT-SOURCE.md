# Imported fingerprint bank

Source: https://github.com/Ikaleio/lm-detector
Commit: `175355e8939c2ee7aaeeac2b22186fa5940412c3`
File: `data/unified_bank.json`; statistical vectors/calibration are imported intact, with a neutral ModelTrace label for the upstream Astra/6.1-Sol shared class; MIT license in `lm-detector-LICENSE`.

The 64-class bank replaces the old 18-class statistical bank as a whole. Centroids,
model order and calibration must stay together; concatenating models is invalid.
Original data remains recoverable in Git history.

ModelTrace continues to use its existing robust scorer and the bank's matching
`robust` and `calibration` fields. This does not adopt lm-detector's newer frozen
`shared_detector.bin` ranker and must not claim that ranker's evaluation accuracy.
Codex long-context/multilingual fork accuracy remains uncalibrated.

Upstream combines 36 `gpt-6-astra` OpenAI-direct references and 36 `gpt-6.1-sol`
OpenRouter/OpenAI references because this number-fingerprint method does not reliably
distinguish them. ModelTrace keeps that calibrated statistical class but names it
`gpt-6.1-sol-astra-shared` / `gpt-6.1-sol/astra`, with both original model labels as
aliases. This avoids presenting shared evidence as pure Astra and leaves room for a
future independently calibrated Astra or 6.1-Sol class. Raw expected labels and
historical samples are preserved. Legacy Claude labels resolve to the corresponding
decimal-version labels. No samples are collected during import.
