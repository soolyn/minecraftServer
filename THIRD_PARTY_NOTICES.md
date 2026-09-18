# Third-party components

- Electron 44.4.1: MIT, https://github.com/electron/electron. Chromium and other notices ship in LICENSES.chromium.html with the executable.
- @xmcl/core 2.16.2 and @xmcl/installer 6.3.4: MIT, https://github.com/Voxelum/minecraft-launcher-core-node. Their installed package license notices are preserved in the application dependencies. Patches in patches/ correct two published package entry-point problems; they do not change authentication or gameplay.
- Minecraft and Microsoft Java runtime files are downloaded from Mojang/Microsoft endpoints to the user's installation. Minecraft is a trademark of Mojang Studios. This is an unofficial, independently developed launcher.
- Fabric API, Sodium and Iris are downloaded from their author-published Modrinth version URLs; they are not bundled in the launcher executable. Their JARs preserve their original notices. Exact versions, URLs and hashes are in the signed client manifest.
- Sooly UI uses the existing production JAR as-is. No third-party monster archive or experimental server assets are included.

## Protocol references (checked 2026-09-18)

- Microsoft identity platform authorization code + PKCE: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Launcher registration and Minecraft API access guidance: https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md
- Minecraft API application review: https://aka.ms/mce-reviewappid
