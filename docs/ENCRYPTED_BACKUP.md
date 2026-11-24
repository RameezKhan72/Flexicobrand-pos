# FLEXICO secure local backup & safe restore (v1.3)

**Purpose:** The SQLite store database and locally cached product photos are your business records. The cloud owner mirror is **not** a backup and is **not** the checkout database.

This optional local utility creates an encrypted `.fxvault` containing a consistent SQLite online snapshot **plus files from `public/uploads/`**, using scrypt key derivation and AES-256-GCM authentication. It operates locally on Node.js 22.13+ without external npm packages.

## Create and verify (Windows PowerShell)

Open PowerShell in the extracted POS folder. Do not share the passphrase or store it in source control.

```powershell
$secret = Read-Host 'Enter a long, unique vault passphrase' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $env:FLEXICO_BACKUP_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
node tools/secure-vault.js create
```

The utility prints the `.fxvault` location. Copy this encrypted file to a second device or an approved offsite storage location. Do **not** keep your only backup on the same PC. Verify a backup regularly:

```powershell
node tools/secure-vault.js verify 'C:\path\to\backup.fxvault'
```

Remove the temporary secret from that PowerShell session when finished:

```powershell
Remove-Item Env:FLEXICO_BACKUP_PASSPHRASE
```

## Restore drill

Stop all POS processes first and **never overwrite the working database**. Use the tool to unpack into a *new, non-existent folder*:

```powershell
node tools/secure-vault.js restore 'C:\path\to\backup.fxvault' 'C:\Flexico_Restore_Trial'
```

This creates `C:\Flexico_Restore_Trial\data\flexico.sqlite` and `public\uploads`. The utility verifies the authenticated data and SQLite integrity before writing. Review the restored data in an isolated testing copy before any decision to replace your store's source of truth.

## Operational limits

- **200 MB uncompressed size limit** for the first edition to avoid uncontrolled RAM use. Larger stores require a professionally managed streaming/offsite backup solution.
- **No automatic daily remote backup or restore automation** is configured. This must be provided and tested before go-live.
- The passphrase is essential: without it, encrypted data cannot be recovered.
- Local database remains unencrypted during normal POS use. Restrict store Windows account and disk access.
- Do not attempt to run two independent POS databases as cashiers. The cloud receiver deliberately pairs to one authoritative store device.
