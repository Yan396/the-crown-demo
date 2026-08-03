# Friend-test telemetry tuning record

## Corpus status

No `crown1.` or `crown2.` result codes were present in the repository or the
provided attachments during the F4 assembly. Therefore no promise threshold,
pacing, tooltip copy, or difficulty CONFIG value was changed under the label of
“friend-test findings.” Inventing a distribution would make the tuning record
misleading.

## Reproducible intake

Use the existing unlinked `outputs/decode.html` for one code. For a corpus, save
one code per line and run:

```sh
node work/analyze_playtests.mjs path/to/codes.txt
```

The report covers quit point by act/screen, tooltip-view rates, promise
distributions, and session duration. Any later change must stay in `CONFIG` or
strings, identify the source corpus, and rerun the phase gate plus autoplay.

