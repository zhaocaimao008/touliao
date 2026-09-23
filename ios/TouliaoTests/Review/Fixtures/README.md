`ui-preview.mp4` is a locally generated, one-second 32×32 H.264 blue frame clip,
used only by the iOS test target for upload byte integrity, download and AVKit checks.
No customer content or account data is included.

Generated with:

```sh
ffmpeg -f lavfi -i color=c=0x2864f0:s=32x32:r=5:d=1 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart ui-preview.mp4
```
