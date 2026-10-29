/**
 * Generates the COMMITTED debug keystore used by every CI build.
 *
 * Why: GitHub Actions runners are fresh each run, so Gradle's default
 * ~/.android/debug.keystore differs on every build → the new APK can never
 * install over the old one ("App not installed"). A keystore committed to the
 * repo gives every build the same signature, so updates install cleanly.
 *
 * Run once:  node scripts/gen-keystore.mjs
 * Output:    android/app/repcoun-debug.p12  (alias/password: repcoun)
 *
 * This is a DEBUG key for sideloading only — do not use it for release builds.
 */
import forge from "node-forge";
import fs from "node:fs";

const OUT = "android/app/repcoun-debug.p12";
const PASSWORD = "repcoun";
const ALIAS = "repcoun";

if (fs.existsSync(OUT)) {
  console.log(`${OUT} already exists — keeping it (signature stays stable).`);
  process.exit(0);
}

const pki = forge.pki;
const keys = pki.rsa.generateKeyPair(2048);

const cert = pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01" + Date.now().toString(16);
cert.validity.notBefore = new Date("2024-01-01T00:00:00Z");
cert.validity.notAfter = new Date("2054-01-01T00:00:00Z");

const attrs = [
  { name: "commonName", value: "RepCoun Debug" },
  { name: "organizationName", value: "RepCoun" },
  { name: "countryName", value: "US" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
  { name: "basicConstraints", cA: true },
  { name: "keyUsage", digitalSignature: true, keyCertSign: true, keyEncipherment: true },
  { name: "subjectKeyIdentifier" },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

// algorithm '3des' = classic PKCS#12 PBE — readable by every Java version.
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, PASSWORD, {
  friendlyName: ALIAS,
  algorithm: "3des",
});

fs.writeFileSync(OUT, Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
console.log(`Wrote ${OUT} (alias: ${ALIAS}, password: ${PASSWORD})`);
