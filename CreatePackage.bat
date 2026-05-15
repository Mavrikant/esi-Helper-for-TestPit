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

echo.
for %%f in (*.vsix) do (
  if exist "%CODE_STABLE%" (
    echo Installing %%f into VS Code (stable)...
    call "%CODE_STABLE%" --install-extension "%%f" --force || exit /b 1
  )
  if exist "%CODE_INSIDERS%" (
    echo Installing %%f into VS Code Insiders...
    call "%CODE_INSIDERS%" --install-extension "%%f" --force || exit /b 1
  )
  if not exist "%CODE_STABLE%" if not exist "%CODE_INSIDERS%" (
    echo ERROR: neither VS Code stable nor Insiders found at the expected paths.
    echo   stable:   %CODE_STABLE%
    echo   insiders: %CODE_INSIDERS%
    exit /b 1
  )
)

echo.
echo Reload your VS Code window ^(Ctrl+Shift+P -^> "Developer: Reload Window"^) to pick up the new build.
