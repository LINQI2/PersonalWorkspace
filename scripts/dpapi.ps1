param([ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  $entropy = [Text.Encoding]::UTF8.GetBytes('PersonalKnowledge.AI.CurrentUser.v1')
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($Operation -eq 'protect') { $result = [Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,$scope) }
  else { $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,$scope) }
  [Console]::Out.Write([Convert]::ToBase64String($result))
  [Array]::Clear($bytes,0,$bytes.Length)
  [Array]::Clear($result,0,$result.Length)
} catch { [Console]::Error.Write('Credential protection failed.'); exit 1 }
