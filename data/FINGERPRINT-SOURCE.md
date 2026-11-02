# Imported fingerprint bank

Source: https://github.com/Ikaleio/lm-detector
Commit: `175355e8939c2ee7aaeeac2b22186fa5940412c3`
File: `data/unified_bank.json`, imported intact; MIT license in `lm-detector-LICENSE`.

The 64-class bank replaces the old 18-class statistical bank as a whole. Centroids,
model order and calibration must stay together; concatenating models is invalid.
Original data remains recoverable in Git history.

ModelTrace continues to use its existing robust scorer and the bank's matching
`robust` and `calibration` fields. This does not adopt lm-detector's newer frozen
`shared_detector.bin` ranker and must not claim that ranker's evaluation accuracy.
Codex long-context/multilingual fork accuracy remains uncalibrated.

`gpt-6-astra` is displayed upstream as `gpt-6-astra/6.1-sol`. Guard resolves
`gpt-6.1-sol` to this shared class without claiming to distinguish them; raw expected
labels and historical samples are preserved. Legacy Claude labels resolve to the
corresponding decimal-version labels. No samples are collected during import.
