## TestPit profile

Profiles are not defined in this extension. They come from TestPit's own settings in the Windows registry:

`HKEY_CURRENT_USER\Software\ESEN\TestPit`

Each profile names the XML configuration files of one project (cable/message config, A429, 1553, discrete, partition ports, VORILS, External Data). The active profile decides:

- which component, field and enum names completion and hover offer,
- which names the component checks accept,
- which configuration files are passed to `TestPit.exe` for the validity check.

The active profile is shown in the **status bar, bottom right**. Click it to switch.

If the item reads *No TestPit profiles*, nothing was found in the registry — see the next step.
