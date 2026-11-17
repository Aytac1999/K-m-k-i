; Gomruk Komekcisi - Windows qurasdirici (Inno Setup 6)
[Setup]
AppId={{6F1B7C52-2A4E-4C57-9E43-0A1B2C3D4E5F}
AppName=Gomruk Komekcisi
AppVersion=1.0
DefaultDirName={userprofile}\GomrukKomekcisi
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\out
OutputBaseFilename=Gomruk-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Gomruk Komekcisi
WizardStyle=modern

[Files]
Source: "..\build\cft\chrome-win64\*"; DestDir: "{app}\chrome"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\build\extension\*"; DestDir: "{app}\extension"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autodesktop}\Gomruk Komekcisi"; Filename: "{app}\chrome\chrome.exe"; Parameters: "--user-data-dir=""{app}\profile"" --load-extension=""{app}\extension"" --no-first-run --no-default-browser-check --disable-features=DisableLoadExtensionCommandLineSwitch https://e.customs.gov.az/"; WorkingDir: "{app}\chrome"
Name: "{userprograms}\Gomruk Komekcisi"; Filename: "{app}\chrome\chrome.exe"; Parameters: "--user-data-dir=""{app}\profile"" --load-extension=""{app}\extension"" --no-first-run --no-default-browser-check --disable-features=DisableLoadExtensionCommandLineSwitch https://e.customs.gov.az/"; WorkingDir: "{app}\chrome"

[Run]
Filename: "{app}\chrome\chrome.exe"; Parameters: "--user-data-dir=""{app}\profile"" --load-extension=""{app}\extension"" --no-first-run --no-default-browser-check --disable-features=DisableLoadExtensionCommandLineSwitch https://e.customs.gov.az/"; Description: "Gomruk Komekcisini indi ac"; Flags: nowait postinstall skipifsilent
