# Reconstruction validation — September 2026

This feature is assisted reconstruction, not an exact match recovery guarantee. Detection counts, successful source decoding and a smooth animation are not evidence that identities or trajectories are correct.

## What changed

- The previous local patch search permanently stopped trying an identity after a short loss. The replacement searches the calibrated field on every sampled frame and can re-identify a robot after long gaps or displacement.
- Foreground-density proposals are matched jointly to fixed reference appearances, with one-to-one assignments and an explicit unmatched choice. It does not force four robots into every frame. Automatic self-learning was tested and discarded because it increased identity drift on the long recording.
- The ball uses a separate small-object path. Dark IR-ball references use compact dark-region contrast, locally recentered reference templates and multiple appearance scales. Contrast against goal flooring does not require a completely green surrounding ring. Orange references retain the generic colour/foreground path.
- Ball radius is not shrunk from a single potentially off-centre click. A tested automatic-radius approach failed on this exact fixture and was removed.
- A coarse search with strict pixel-level refinement reduces ball-search work; the final shape/appearance acceptance checks remain unchanged. Ambiguous or hidden balls remain gaps.
- Supported white boundary lines provide bounded camera alignment. Different views still need separate calibration. Robot orientation remains estimated from movement unless corrected manually.
- The full recording is the default clip range, up to the existing 60-minute-per-clip limit. A reference can be selected anywhere, including after the beginning of the replay. Continuing or trimming preserves hidden actors' original references and accepted calibration.

## Test protocol

The local fixture is `Finale_lightweight.mp4`: 1280 × 720, duration 1725.804 seconds. The full-sequence benchmark decodes 17,258 frames at 10 samples/s and processes them chronologically, using a separately decoded reference at 400 seconds. Tracking pixels are 960 × 540, matching the browser pipeline. No source footage, extracted images or model-service requests are sent to GitHub or another server.

Reference identities are assigned to the four chassis in the reference frame: red angular → Blue 1; pale/pink angular → Blue 2; white ring → Yellow 1; black ring → Yellow 2. These are reconstruction labels, not independently inferred team colours.

The development set contains 58 systematically spaced annotated frames, at 15 + 30n seconds. After annotations were used to diagnose misses, this became a **tuning/validation set**, not a held-out test. A separate set of 12 timestamps was specified before its visual annotation: 90, 240, 390, 540, 600, 1170, 1230, 1320, 1410, 1500, 1590 and 1680 seconds. That annotator did not inspect predictions. However, imagery at 600 and 1500 seconds had previously been inspected in detector/alignment prototypes, so this is an **independent annotation check**, not an entirely unseen held-out set (the benchmark JSON's legacy key is `heldout`). Labels were produced by an independent agent's visual inspection and overlay review, not an official referee panel.

Metrics use visibly free, on-arena objects during the annotated halves. Human-held/off-arena objects are excluded from the in-play denominator; predictions near their labelled centres are reported separately rather than counted as successful tracking. A ball that cannot be confidently seen is an abstention, not a verified negative.

Predictions are matched to visible centres one-to-one within 14 pixels at 640-pixel-equivalent scale. Detection recall, correct-identity recall and unmatched predictions are separate measures. This tolerance is deliberately wider than annotation uncertainty (approximately 6 pixels); it does not establish millimetre-level trajectory accuracy. Sparse labels cannot establish continuous identity-switch rate, correct robot heading, handling/lifting, goal legality, or accuracy on other recordings/camera angles.

The benchmark's sequential FFmpeg decode is **not a browser completion-time measurement**. The browser seeks each sample independently. Browser QA separately exercised an eight-second clip, precise seeking, 81 inclusive samples, cancellation, hidden-actor continuation, save/load and video relinking. No tracking exceptions were observed. The original external rules iframe can make its own network requests; local video processing does not upload footage.

## Measured full-recording results

The final chronological run completed all **17,258 frames / 1725.8 seconds**, at 960 × 540 and 10 samples/s, without restarting at the annotated timestamps. The fixed reference frame was 400 seconds. The independent check labels were not used to change the final detector.

| Measure | Development/tuning samples | Independent check samples |
| --- | --- | --- |
| Visible robot centres detected | 92 / 94 (97.9%) | 31 / 32 (96.9%) |
| Visible robots with correct identity | 86 / 94 (91.5%) | 28 / 32 (87.5%) |
| Unmatched robot predictions | 10 | 4 |
| Robot detection precision | 92 / 102 (90.2%) | 31 / 35 (88.6%) |
| Visible balls detected | 15 / 24 (62.5%) | 7 / 11 (63.6%) |
| Wrong ball predictions on ball-visible samples | 1 | 0 |
| Mean matched robot centre error, at 640-pixel-equivalent scale | 5.15 pixels | 4.98 pixels |
| Mean matched ball centre error, at 640-pixel-equivalent scale | 2.60 pixels | 2.25 pixels |

Predictions near labelled held/off-arena robots were excluded: 28 in the development set and 8 in the independent set. Robot precision assesses object location, not correct identity. The ball rows cover only the small, visibly labelled subset; zero wrong predictions among 11 visible-ball examples is not a false-positive guarantee for the whole recording.

Excluding the known prior-inspection overlaps at 600 and 1500 seconds leaves ten check timestamps: 26 / 27 robot centres (96.3%), 24 / 27 correct identities (88.9%), 3 unmatched robot predictions (89.7% detection precision), and 6 / 10 visible balls (60.0%) with no wrong ball prediction on those visible-ball examples. This still evaluates the same recording used for development, not generalization to a new match or camera.

**The requested 90–95% end-to-end reconstruction accuracy has not been demonstrated.** Robot re-detection is substantially improved, but identity swaps, detections of hands/held equipment, and missed small dark balls remain. In particular, 96.9% centre detection must not be described as 96.9% correct robot tracking over continuous time. The independently checked identity result is 87.5%, and ball recall is about 64%.

This local Node/FFmpeg run took 1056.7 seconds (17 min 37 s). It is not a browser-speed promise. Browser QA with the same 960-pixel tracking path processed an eight-second clip into 81 inclusive samples and verified loss/recovery, cancellation and an exact save/load round trip. A complete local replay file was also serialized and schema-validated: 17,258 samples, 10.85 MB, with 404 **suggested**, unconfirmed events and no automatically confirmed goals. Its final sampled timestamp is 1725.7 seconds; no extra terminal frame was invented.

The complete replay was then loaded through the app in an isolated Chrome session (834 ms import on the test computer), relinked to the local recording, and exercised around 860, 900 and 1715.7 seconds. Source/replay seeking and play/pause worked, end-of-replay playback stopped at 1725.7 seconds, and returning to the start reset both clocks to zero. No console errors or unresponsive timeline were observed. These are usability checks on this machine, not hardware-independent performance guarantees.

The automatic replay is explicitly marked **review required**. Team/robot assignments come from the selected reference labels. Suggested events and score must be checked against the recording before the replay is used for referee instruction or assessment.

## Why this release does not simply add stock YOLO

The standard pretrained YOLO11 detector targets COCO's 80 categories; the category list has no RCJ soccer robot class. A sports-ball category alone does not establish reliable tiny IR-ball detection. A custom-trained detector needs representative labelled RCJ footage and held-out evaluation. [YOLO11 documentation](https://docs.ultralytics.com/models/yolo11/), [official COCO category configuration](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/datasets/coco.yaml).

YOLOE supports visual reference prompts, but its standard ONNX exports bake prompts into the model; a static export cannot accept arbitrary new user reference images. Browser inference is feasible with ONNX Runtime Web, but implementing a dynamic visual-prompt encoder/export or training a dedicated RCJ detector is a separate, testable engineering step—not something to label as working merely because the library loads. [YOLOE export behaviour](https://docs.ultralytics.com/models/yoloe/#export-usage), [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).

For stronger cross-recording accuracy, the next validation work is a representative labelled set covering different cameras, robot designs, dark/orange balls, goal backgrounds, hands, removals and occlusions. Any trained replacement should be compared against this detector on held-out sequences and tested in the browser; a 95% end-to-end claim is not justified by a model name or a short demo.
