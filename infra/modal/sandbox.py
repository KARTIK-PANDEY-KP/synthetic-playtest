#!/usr/bin/env python3
"""
Modal sandbox control — one sandbox per persona. Driven by apps/orchestrator/src/backends/modal.mjs.

  run     --run-id ID --key KEY --persona FILE --out DIR --seed N [--runner PATH] [--max-steps N]
          Creates a sandbox, serves the game in-sandbox on 5273, runs the runner with
          --viewer-port 8080 (exposed via an encrypted tunnel), relays the runner's
          SessionEvent lines to stdout, downloads the persona dir when it exits, and
          terminates the sandbox. stdin accepts {"cmd":"pause"|"resume"|"stop"}.
  build   [--force]      build the image now (first build takes several minutes)
  probe   [--save-dir D] one sandbox: boot time, image size, in-sandbox Playwright
                         screenshot, tunnel /health + /live from this machine; then tear down
  list                   sandboxes of the app
  cleanup                terminate every sandbox of the app

stdout protocol (one JSON per line):
  {"_ctl":"sandbox","sandboxId":..,"tunnelUrl":..,"bootMs":..}   {"_ctl":"log","msg":..}
  {"_ctl":"downloaded","files":N}   {"_ctl":"exit","code":N}   <SessionEvent lines relayed as-is>

Uses the active Modal profile (never hardcoded). Secret: --secret-name (default codex-api-key),
created from local CODEX_API_KEY if missing; if neither exists codex cannot authenticate and we say so.
"""
import argparse
import io
import json
import os
import signal
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modal  # noqa: E402
from image import APP_DIR, build_image  # noqa: E402

GAME_URL = "http://127.0.0.1:5273/"
FAKE_RUNNER = f"{APP_DIR}/apps/orchestrator/dev/fake-runner.mjs"
RUNNER_PATTERN = "runner.mjs"  # matches runner.mjs and fake-runner.mjs for pkill -f


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def log(msg):
    out({"_ctl": "log", "msg": str(msg)})


def get_app(name):
    return modal.App.lookup(name, create_if_missing=True)


def codex_secret(name):
    """Return (secret_or_None, note). Creates the named secret from local CODEX_API_KEY if missing."""
    try:
        s = modal.Secret.from_name(name, required_keys=["CODEX_API_KEY"])
        s.hydrate()
        return s, f"codex auth: Modal secret '{name}'"
    except modal.exception.NotFoundError:
        pass
    key = os.environ.get("CODEX_API_KEY", "").strip()
    if not key:
        return None, (f"codex auth: Modal secret '{name}' not found and CODEX_API_KEY is not set locally — "
                      "codex cannot authenticate in the sandbox (fake-runner does not need it)")
    r = subprocess.run(["modal", "secret", "create", name, f"CODEX_API_KEY={key}"], capture_output=True, text=True)
    if r.returncode != 0:
        return modal.Secret.from_dict({"CODEX_API_KEY": key}), f"codex auth: ephemeral secret from local env (could not create '{name}': {r.stderr.strip()[-200:]})"
    return modal.Secret.from_name(name), f"codex auth: created Modal secret '{name}' from local CODEX_API_KEY"


def create_sandbox(app, image, *, secrets, tags, timeout, cpu=2.0, memory=4096):
    return modal.Sandbox.create(
        "node", f"{APP_DIR}/infra/modal/serve-game.mjs", "--port", "5273",
        app=app, image=image, secrets=secrets, encrypted_ports=[8080], timeout=timeout,
        cpu=cpu, memory=memory, workdir=APP_DIR, tags=tags,
    )


def sh(sb, script, timeout=120, text=True):
    p = sb.exec("bash", "-c", script, timeout=timeout, text=text)
    stdout = p.stdout.read()
    stderr = p.stderr.read()
    code = p.wait()
    return code, stdout, stderr


def wait_game(sb, tries=100):
    code, _, err = sh(sb, f"for i in $(seq 1 {tries}); do curl -sf {GAME_URL} >/dev/null && exit 0; sleep 0.2; done; exit 1", timeout=60)
    if code != 0:
        raise RuntimeError(f"game did not come up on 5273 inside the sandbox: {err.strip()[-300:]}")


def write_file(sb, path, content: str):
    p = sb.exec("bash", "-c", f"mkdir -p \"$(dirname '{path}')\" && cat > '{path}'", timeout=60)
    p.stdin.write(content)
    p.stdin.write_eof()
    p.stdin.drain()  # write() only buffers; without drain() cat never sees EOF and wait() hangs
    code = p.wait()
    if code != 0:
        raise RuntimeError(f"writing {path} in the sandbox failed (exit {code})")


def pick_runner(sb, preferred):
    code, _, _ = sh(sb, f"test -f '{preferred}'")
    if code == 0:
        return preferred
    log(f"runner {preferred} not present in the sandbox — falling back to fake-runner")
    return FAKE_RUNNER


def download(sb, key, local_parent):
    """tar the persona dir out of /out and extract into local_parent/<key>/."""
    p = sb.exec("tar", "-C", "/out", "-czf", "-", key, text=False)
    data = p.stdout.read()
    code = p.wait()
    if code != 0 or not data:
        raise RuntimeError(f"tar of /out/{key} failed (exit {code}, {len(data or b'')} bytes)")
    n = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
        members = tf.getmembers()
        n = sum(1 for m in members if m.isfile())
        tf.extractall(path=local_parent, filter="data")
    return n


def relay_stderr(proc, prefix):
    def run():
        try:
            for line in proc.stderr:
                line = line.rstrip("\n")
                if line:
                    log(f"{prefix}[stderr] {line[:400]}")
        except Exception as e:  # noqa: BLE001
            log(f"{prefix} stderr relay ended: {e}")
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


# ── commands ─────────────────────────────────────────────────────────────────
def cmd_run(a):
    app = get_app(a.app_name)
    image = build_image()
    secret, note = codex_secret(a.secret_name)
    log(note)
    with open(a.persona, encoding="utf-8") as f:
        persona_json = f.read()
    local_parent = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(local_parent, exist_ok=True)

    log("creating sandbox (first run builds the image; that can take several minutes)")
    t0 = time.time()
    sb = create_sandbox(app, image, secrets=[secret] if secret else [], tags={"run": a.run_id, "persona": a.key},
                        timeout=a.timeout)
    t_create = time.time()
    state = {"stopping": False, "runner_started": False, "sb": sb}

    def terminate_sandbox(reason):
        try:
            sb.terminate()
            log(f"sandbox terminated ({reason})")
        except Exception as e:  # noqa: BLE001
            log(f"terminate failed: {e}")

    def signal_runner(sig):
        try:
            sh(sb, f"pkill -{sig} -f {RUNNER_PATTERN} || true", timeout=20)
        except Exception as e:  # noqa: BLE001
            log(f"pkill -{sig} failed: {e}")

    def on_term(signum, _frame):
        if state["stopping"]:
            return
        state["stopping"] = True
        log(f"received signal {signum}: stopping runner")
        if state["runner_started"]:
            threading.Thread(target=signal_runner, args=("TERM",), daemon=True).start()
            # hard deadline if the runner ignores SIGTERM
            def deadline():
                time.sleep(25)
                terminate_sandbox("stop deadline")
                out({"_ctl": "exit", "code": 143})
                os._exit(143)
            threading.Thread(target=deadline, daemon=True).start()
        else:
            terminate_sandbox("stopped before runner start")
            out({"_ctl": "exit", "code": 143})
            os._exit(143)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)

    def stdin_commands():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line).get("cmd")
            except json.JSONDecodeError:
                continue
            if cmd == "pause":
                signal_runner("USR1")
            elif cmd == "resume":
                signal_runner("USR2")
            elif cmd == "stop":
                on_term(15, None)
    threading.Thread(target=stdin_commands, daemon=True).start()

    try:
        wait_game(sb)
        remote_out = f"/out/{a.key}"
        write_file(sb, f"{remote_out}/persona.json", persona_json)
        runner = pick_runner(sb, a.runner)
        tunnel = sb.tunnels()[8080].url
        out({"_ctl": "sandbox", "sandboxId": sb.object_id, "tunnelUrl": tunnel,
             "bootMs": int((time.time() - t0) * 1000), "createMs": int((t_create - t0) * 1000), "runner": runner})

        args = ["node", runner, "--persona", f"{remote_out}/persona.json", "--game-url", GAME_URL,
                "--seed", str(a.seed), "--out", remote_out, "--viewer-port", "8080"]
        if a.max_steps:
            args += ["--max-steps", str(a.max_steps)]
        env = {k: v for k, v in os.environ.items() if k.startswith("FAKE_") or k in ("ASTRA_MODEL",)}
        proc = sb.exec(*args, env=env, workdir=APP_DIR, timeout=a.timeout)
        state["runner_started"] = True
        relay_stderr(proc, "runner")
        for line in proc.stdout:
            line = line.rstrip("\n")
            if line:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
        code = proc.wait()
        log(f"runner exited with code {code}")
        try:
            n = download(sb, a.key, local_parent)
            out({"_ctl": "downloaded", "files": n, "to": os.path.join(local_parent, a.key)})
        except Exception as e:  # noqa: BLE001
            log(f"download failed: {e}")
    except Exception as e:  # noqa: BLE001
        log(f"run failed: {e}")
        out({"kind": "status", "status": "failed", "detail": f"modal: {e}", "t": int((time.time() - t0) * 1000)})
        code = 1
    finally:
        terminate_sandbox("run finished")
    out({"_ctl": "exit", "code": code})
    sys.exit(0 if code == 0 else (code if isinstance(code, int) and 0 < code < 256 else 1))


def cmd_build(a):
    app = get_app(a.app_name)
    image = build_image(force_build=a.force)
    t0 = time.time()
    with modal.enable_output():
        image.build(app)
    print(json.dumps({"built": True, "seconds": round(time.time() - t0, 1), "imageId": image.object_id}))


def cmd_probe(a):
    save = a.save_dir or os.getcwd()
    os.makedirs(save, exist_ok=True)
    app = get_app(a.app_name)
    image = build_image()
    secret, note = codex_secret(a.secret_name)
    print(note, file=sys.stderr)
    summary = {}
    t0 = time.time()
    sb = create_sandbox(app, image, secrets=[secret] if secret else [], tags={"run": "probe", "persona": "probe"}, timeout=900)
    summary["createMs"] = int((time.time() - t0) * 1000)
    try:
        wait_game(sb)
        summary["gameUpMs"] = int((time.time() - t0) * 1000)
        tunnel = sb.tunnels()[8080].url
        summary["tunnelMs"] = int((time.time() - t0) * 1000)
        summary["sandboxId"] = sb.object_id
        summary["tunnelUrl"] = tunnel

        _, du, _ = sh(sb, "du -sh --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/out / 2>/dev/null | tail -1; "
                          "du -sh /usr/local/lib/node_modules /app/node_modules /root/.cache/ms-playwright /usr/lib /usr/share 2>/dev/null", timeout=120)
        summary["diskUsage"] = du.strip().splitlines()
        _, ver, _ = sh(sb, "node --version; pnpm --version; codex --version; chromium_dir=$(ls -d /root/.cache/ms-playwright/chromium* | head -1); echo $chromium_dir; id -u", timeout=60)
        summary["versions"] = ver.strip().splitlines()
        _, game, _ = sh(sb, f"curl -s -o /dev/null -w '%{{http_code}} %{{content_type}} %{{size_download}}' {GAME_URL}", timeout=30)
        summary["gameInSandbox"] = game.strip()

        # Playwright screenshot round-trip
        code, shot, err = sh(sb, f"mkdir -p /out && node {APP_DIR}/infra/modal/probe-screenshot.mjs /out/probe.png", timeout=120)
        summary["screenshot"] = shot.strip() or err.strip()[-400:]
        if code == 0:
            cat = sb.exec("cat", "/out/probe.png", text=False)
            png = cat.stdout.read()
            cat.wait()
            local_png = os.path.join(save, "probe.png")
            with open(local_png, "wb") as f:
                f.write(png)
            summary["screenshotLocal"] = f"{local_png} ({len(png)} bytes)"

        # fake runner on 8080 → tunnel reachable from this machine
        env = {"FAKE_STEP_MS": "1500"}
        proc = sb.exec("node", FAKE_RUNNER, "--persona", f"{APP_DIR}/packages/persona-mcp/personas/maya.json",
                       "--game-url", GAME_URL, "--seed", "7", "--out", "/out/probe-maya", "--viewer-port", "8080",
                       "--max-steps", "6", env=env, workdir=APP_DIR, timeout=300)
        health = None
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"{tunnel}/health", timeout=10) as r:
                    health = json.loads(r.read())
                break
            except Exception:  # noqa: BLE001
                time.sleep(1)
        summary["tunnelHealth"] = health
        if health:
            with urllib.request.urlopen(f"{tunnel}/live", timeout=20) as r:
                summary["tunnelLiveContentType"] = r.headers.get("content-type")
                blob = r.read(120_000)
            frames, i, n = [], 0, 0
            while True:
                s = blob.find(b"\xff\xd8\xff", i)
                e = blob.find(b"\xff\xd9", s + 3) if s >= 0 else -1
                if s < 0 or e < 0:
                    break
                frames.append(blob[s:e + 2]); i = e + 2; n += 1
            for k, fr in enumerate(frames[:2]):
                with open(os.path.join(save, f"tunnel-live-{k}.jpg"), "wb") as f:
                    f.write(fr)
            summary["tunnelLiveJpegFrames"] = n
        lines = 0
        for line in proc.stdout:
            lines += 1
        summary["fakeRunnerExit"] = proc.wait()
        summary["fakeRunnerStdoutLines"] = lines
    except Exception as e:  # noqa: BLE001
        summary["error"] = str(e)
    finally:
        sb.terminate()
        summary["totalMs"] = int((time.time() - t0) * 1000)
    print(json.dumps(summary, indent=2))


def cmd_list(a):
    app = get_app(a.app_name)
    rows = []
    for sb in modal.Sandbox.list(app_id=app.app_id):
        rows.append({"sandboxId": sb.object_id, "tags": sb.get_tags(), "returncode": sb.poll()})
    print(json.dumps(rows, indent=2))


def cmd_cleanup(a):
    app = get_app(a.app_name)
    n = 0
    for sb in modal.Sandbox.list(app_id=app.app_id):
        if sb.poll() is None:
            sb.terminate()
            n += 1
            print(f"terminated {sb.object_id} {sb.get_tags()}")
    print(json.dumps({"terminated": n}))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app-name", default=os.environ.get("MODAL_APP_NAME", "synthetic-playtest"))
    ap.add_argument("--secret-name", default=os.environ.get("MODAL_SECRET_NAME", "codex-api-key"))
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run")
    r.add_argument("--run-id", required=True)
    r.add_argument("--key", required=True)
    r.add_argument("--persona", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--seed", type=int, default=1)
    r.add_argument("--runner", default=f"{APP_DIR}/packages/persona-mcp/runner.mjs")
    r.add_argument("--max-steps", type=int, default=None)
    r.add_argument("--timeout", type=int, default=3600)
    r.set_defaults(fn=cmd_run)

    b = sub.add_parser("build")
    b.add_argument("--force", action="store_true")
    b.set_defaults(fn=cmd_build)

    p = sub.add_parser("probe")
    p.add_argument("--save-dir", default=None)
    p.set_defaults(fn=cmd_probe)

    sub.add_parser("list").set_defaults(fn=cmd_list)
    sub.add_parser("cleanup").set_defaults(fn=cmd_cleanup)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
