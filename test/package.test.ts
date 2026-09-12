import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");

test("the packed plugin loads from node_modules with its exported configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oxlint-slop-package-"));
  try {
    const packed = Bun.spawnSync(["bun", "pm", "pack", "--destination", directory], { cwd: repository, stdout: "pipe", stderr: "pipe" });
    expect(packed.exitCode, new TextDecoder().decode(packed.stderr)).toBe(0);
    const consumer = join(directory, "consumer");
    await mkdir(consumer);
    await Bun.write(join(consumer, "package.json"), JSON.stringify({
      name: "plugin-consumer-test",
      private: true,
      type: "module",
      dependencies: {
        "@obviyus/oxlint-slop": `file:${join(directory, "obviyus-oxlint-slop-0.2.0.tgz")}`,
        "@oxlint/plugins": `file:${join(repository, "node_modules/@oxlint/plugins")}`,
        oxlint: `file:${join(repository, "node_modules/oxlint")}`,
      },
    }));
    const installed = Bun.spawnSync(["bun", "install", "--ignore-scripts"], { cwd: consumer, stdout: "pipe", stderr: "pipe" });
    expect(installed.exitCode, new TextDecoder().decode(installed.stderr)).toBe(0);
    await Bun.write(join(consumer, "oxlint.config.ts"), 'import slop from "@obviyus/oxlint-slop/config"; export default slop;');
    await Bun.write(join(consumer, "view.tsx"), 'export function View() { try { return <a href="?a=1&font=Name;500"/>; } catch { return null; } }');
    const linted = Bun.spawnSync([join(repository, "node_modules/.bin/oxlint"), "--format", "json", "view.tsx"], { cwd: consumer, stdout: "pipe", stderr: "pipe" });
    expect(linted.exitCode, new TextDecoder().decode(linted.stdout)).toBe(0);
    const result: { diagnostics: { code: string }[]; number_of_files: number } = JSON.parse(new TextDecoder().decode(linted.stdout));
    expect(result.number_of_files).toBe(1);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["slop(no-silent-catch-fallback)"]);
    const scored = Bun.spawnSync([join(consumer, "node_modules/.bin/oxlint-slop-score"), "--json", "view.tsx"], { cwd: consumer, stdout: "pipe", stderr: "pipe" });
    expect(scored.exitCode, new TextDecoder().decode(scored.stderr)).toBe(0);
    const score: { complete: boolean; scores: { verbosity: number; erosion: number } } = JSON.parse(new TextDecoder().decode(scored.stdout));
    expect(score.complete).toBe(true);
    expect(score.scores).toEqual({ verbosity: 1, erosion: 0 });
  } finally {
    await rm(directory, { recursive: true });
  }
});
