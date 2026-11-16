const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { resolve } = require("node:path");

function dependency(parent, name) {
  return createRequire(parent.resolve(`${name}/package.json`));
}
const cli = dependency(require, "@angular/cli");
const pacote = dependency(cli, "pacote");

test("patched glob preserves the CLI package discovery API and cancellation", async () => {
  const packageJson = dependency(pacote, "@npmcli/package-json");
  const { glob } = packageJson("glob");
  const cwd = resolve(__dirname, "..");
  assert.ok(
    (await glob("src/app/*.ts", { cwd })).includes("src/app/app.component.ts"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(glob("**/*", { cwd, signal: controller.signal }), {
    name: "AbortError",
  });
});

test("patched minimatch preserves the ignore-walk matching interface", () => {
  const packlist = dependency(pacote, "npm-packlist");
  const walker = dependency(packlist, "ignore-walk");
  const { Minimatch } = walker("minimatch");
  const matcher = new Minimatch("src/**/*.ts");
  assert.equal(matcher.match("src/app/app.component.ts"), true);
  assert.equal(matcher.match("src/styles.css"), false);
});

test("patched uuid preserves SockJS CommonJS v4 session identifiers", () => {
  const builder = dependency(require, "@angular-devkit/build-angular");
  const server = dependency(builder, "webpack-dev-server");
  const sockjs = dependency(server, "sockjs");
  const { v4, validate, version } = sockjs("uuid");
  const id = v4();
  assert.equal(validate(id), true);
  assert.equal(version(id), 4);
  assert.notEqual(id, v4());
  assert.equal(typeof server("sockjs").createServer, "function");
});
