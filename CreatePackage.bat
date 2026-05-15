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

echo.
for %%f in (*.vsix) do (
  echo Installing %%f into VS Code...
  call code --install-extension "%%f" --force || exit /b 1
)
