@echo off
setlocal
echo === ESI Helper for TestPit: clean build + package + install ===

if exist "out" rmdir /s /q out
if exist "*.vsix" del /q *.vsix

call npm ci                           || exit /b 1
call npm run lint                     || exit /b 1
call npm test                         || exit /b 1
call npx --yes @vscode/vsce package   || exit /b 1

echo.
dir /b *.vsix

set "CODE_STABLE=C:\Program Files\Microsoft VS Code\Code.exe"
set "CODE_INSIDERS=C:\Program Files\Microsoft VS Code Insiders\Code - Insiders.exe"

set "INSTALLED_ANY="
echo.
for %%f in (*.vsix) do call :install_one "%%f"
if not defined INSTALLED_ANY (
  echo ERROR: neither VS Code stable nor Insiders found at the expected paths.
  echo   stable:   %CODE_STABLE%
  echo   insiders: %CODE_INSIDERS%
  exit /b 1
)

echo.
echo Reload your VS Code window so the new build loads:
echo   Ctrl+Shift+P, then "Developer: Reload Window".
exit /b 0


:install_one
rem %~1 = the .vsix path
if exist "%CODE_STABLE%" (
  echo Installing %~1 into VS Code stable...
  call "%CODE_STABLE%" --install-extension "%~1" --force || exit /b 1
  set "INSTALLED_ANY=1"
)
if exist "%CODE_INSIDERS%" (
  echo Installing %~1 into VS Code Insiders...
  call "%CODE_INSIDERS%" --install-extension "%~1" --force || exit /b 1
  set "INSTALLED_ANY=1"
)
exit /b 0
