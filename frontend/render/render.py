"""Render an offline scene to a seamless looping video (dev tool, not shipped).

usage:  python render/render.py <scene.html> <out-name> [--w 1920 --h 1080 --T 12 --fps 30] [--still t]
Frames are drawn deterministically (window.renderAt(t)), captured as PNG, and encoded with ffmpeg
(from imageio-ffmpeg) to H.264 MP4 + VP9 WebM + a WebP poster, into src/assets/video/.
"""
import argparse, asyncio, os, pathlib, subprocess, sys, tempfile

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "src" / "assets" / "video"


def ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


async def capture(scene: pathlib.Path, w: int, h: int, T: float, fps: int, frames_dir: pathlib.Path, still: float | None):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True, args=["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"])
        pg = await b.new_page(viewport={"width": w, "height": h})
        logs = []
        pg.on("console", lambda m: logs.append(m.text))
        pg.on("pageerror", lambda e: logs.append(str(e)))
        await pg.goto(f"{scene.as_uri()}?w={w}&h={h}&T={T}")
        try:
            await pg.wait_for_function("window.__ready === true", timeout=60000)
        except Exception:
            print("\n".join(logs)); raise
        canvas = pg.locator("canvas")
        if still is not None:
            await pg.evaluate(f"window.renderAt({still})")
            await canvas.screenshot(path=str(frames_dir / "still.png"))
        else:
            n = int(round(T * fps))
            for i in range(n):
                await pg.evaluate(f"window.renderAt({i / fps})")
                await canvas.screenshot(path=str(frames_dir / f"f{i:04d}.png"))
                if i % 30 == 0:
                    print(f"frame {i}/{n}", flush=True)
        await b.close()


def encode(frames_dir: pathlib.Path, name: str, fps: int, w: int):
    OUT.mkdir(parents=True, exist_ok=True)
    ff, src = ffmpeg(), str(frames_dir / "f%04d.png")
    common = ["-y", "-framerate", str(fps), "-i", src]
    subprocess.run([ff, *common, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an", str(OUT / f"{name}.mp4")], check=True, capture_output=True)
    subprocess.run([ff, *common, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-deadline", "good",
                    "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", str(OUT / f"{name}.webm")], check=True, capture_output=True)
    subprocess.run([ff, "-y", "-i", str(frames_dir / "f0000.png"), "-q:v", "80", str(OUT / f"{name}-poster.webp")],
                   check=True, capture_output=True)
    for ext in ("mp4", "webm"):
        print(name, ext, f"{(OUT / f'{name}.{ext}').stat().st_size / 1024:.0f} KB")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("scene"); a.add_argument("name")
    a.add_argument("--w", type=int, default=1920); a.add_argument("--h", type=int, default=1080)
    a.add_argument("--T", type=float, default=12); a.add_argument("--fps", type=int, default=30)
    a.add_argument("--still", type=float, default=None)
    args = a.parse_args()
    scene = (HERE / args.scene).resolve()
    with tempfile.TemporaryDirectory() as tmp:
        d = pathlib.Path(tmp)
        asyncio.run(capture(scene, args.w, args.h, args.T, args.fps, d, args.still))
        if args.still is not None:
            target = HERE / f"_still_{args.name}.png"
            target.write_bytes((d / "still.png").read_bytes()); print("still ->", target)
        else:
            encode(d, args.name, args.fps, args.w)


if __name__ == "__main__":
    main()
