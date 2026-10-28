import { execFileSync } from "node:child_process";
import { dirname, basename, join } from "node:path";
import { rmSync } from "node:fs";

// Pass paths through the Unicode environment, not PowerShell source or a
// narrow-character tar command line. .NET also preserves dotfiles in the ZIP.
function windowsZip(command, source, destination) {
  execFileSync(
    join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
        command,
    ],
    {
      env: {
        ...process.env,
        STT_ZIP_SOURCE: source,
        STT_ZIP_DESTINATION: destination,
      },
      stdio: "inherit",
    },
  );
}
export function createArchive(source, archive) {
  rmSync(archive, { force: true });
  if (process.platform === "win32") {
    windowsZip(
      "[System.IO.Compression.ZipFile]::CreateFromDirectory($env:STT_ZIP_SOURCE, $env:STT_ZIP_DESTINATION, [System.IO.Compression.CompressionLevel]::Optimal, $true)",
      source,
      archive,
    );
  } else {
    execFileSync("zip", ["-qr", archive, basename(source)], {
      cwd: dirname(source),
      stdio: "inherit",
    });
  }
}
export function extractArchive(archive, destination) {
  if (process.platform === "win32") {
    windowsZip(
      "[System.IO.Compression.ZipFile]::ExtractToDirectory($env:STT_ZIP_SOURCE, $env:STT_ZIP_DESTINATION)",
      archive,
      destination,
    );
  } else {
    execFileSync("unzip", ["-q", archive, "-d", destination], {
      stdio: "inherit",
    });
  }
}
