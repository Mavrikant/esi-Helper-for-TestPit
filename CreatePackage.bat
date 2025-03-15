@echo off
echo ===== ESI Helper for TestPit - Clean Build Package Script =====

echo.
echo Cleaning previous build artifacts...
if exist "out" rmdir /s /q out
if exist "*.vsix" del /q *.vsix

echo.
echo Installing dependencies...
call npm install

echo.
echo Compiling TypeScript files...
call npm run compile

echo.
echo Creating extension package...
call npx vsce package

echo.
echo Package creation complete!
echo.

dir *.vsix -h