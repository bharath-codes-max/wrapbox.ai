/**
 * `wrapboxd ca ...` — manage the local certificate authority that makes
 * content inspection possible.
 *
 * Installing a trusted root is a serious change to a machine, so these
 * commands are explicit, reversible, and say plainly what they are doing.
 * The password prompt on install is not a wart to be engineered away — a
 * person SHOULD have to approve adding a root certificate.
 */

import {
  ensureCA,
  caStatus,
  installTrust,
  uninstallTrust,
  CA_PATHS,
} from "../ca.js";

function usage(): number {
  console.log(`wrapboxd ca <subcommand>

  init        Create the Wrapbox root CA if it does not exist
  install     Trust the CA on this Mac (asks for your password)
  uninstall   Remove the CA from the trust store
  status      Show whether the CA exists and is trusted

Content inspection — seeing the prompt text and the uploaded file rather
than just the hostname — requires the CA to be installed and trusted.
`);
  return 0;
}

export async function cmdCa(args: string[]): Promise<number> {
  const sub = args[0];

  switch (sub) {
    case "init": {
      const { certPem, created } = ensureCA();
      const st = await caStatus();
      console.log(created ? "✔ Created the Wrapbox root CA." : "• CA already exists.");
      console.log(`  Certificate : ${CA_PATHS.cert}`);
      console.log(`  Fingerprint : ${st.fingerprint ?? "(unreadable)"}`);
      console.log(`  Trusted     : ${st.trusted ? "yes" : "NO — run: wrapboxd ca install"}`);
      if (!certPem.includes("BEGIN CERTIFICATE")) {
        console.error("✖ The certificate file does not look like a PEM certificate.");
        return 1;
      }
      return 0;
    }

    case "install": {
      ensureCA();
      const before = await caStatus();
      if (before.trusted) {
        console.log("• Already trusted — nothing to do.");
        return 0;
      }
      console.log("Installing the Wrapbox root CA into the system keychain.");
      console.log("macOS will ask for your password — that prompt is expected.");
      console.log("");
      try {
        await installTrust();
      } catch (err) {
        console.error(`✖ Install failed: ${(err as Error).message}`);
        console.error("  Nothing was changed. Content inspection stays off.");
        return 1;
      }
      const after = await caStatus();
      if (!after.trusted) {
        console.error("✖ The certificate was added but the system does not report it as trusted.");
        return 1;
      }
      console.log("✔ Wrapbox root CA is trusted on this Mac.");
      console.log(`  Fingerprint: ${after.fingerprint}`);
      console.log("");
      console.log("  Content inspection can now be switched on:");
      console.log("    wrapboxd daemon --inspect");
      console.log("  Remove it at any time with:  wrapboxd ca uninstall");
      return 0;
    }

    case "uninstall": {
      console.log("Removing the Wrapbox root CA from the trust store (asks for your password).");
      try {
        await uninstallTrust();
      } catch (err) {
        console.error(`✖ Uninstall failed: ${(err as Error).message}`);
        return 1;
      }
      const st = await caStatus();
      console.log(st.trusted
        ? "✖ The system still reports the CA as trusted — remove it in Keychain Access."
        : "✔ Removed. Content inspection will no longer work until it is reinstalled.");
      return st.trusted ? 1 : 0;
    }

    case "status": {
      const st = await caStatus();
      console.log(`CA exists   : ${st.exists ? "yes" : "no"}`);
      console.log(`Trusted     : ${st.trusted ? "yes" : "no"}`);
      console.log(`Certificate : ${st.certPath}`);
      console.log(`Fingerprint : ${st.fingerprint ?? "—"}`);
      console.log(`Minted certs: ${st.leafCount}`);
      if (!st.exists) console.log("\nNext: wrapboxd ca init");
      else if (!st.trusted) console.log("\nNext: wrapboxd ca install");
      return 0;
    }

    default:
      return usage();
  }
}
