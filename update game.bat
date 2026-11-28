@echo off
setlocal

rem ============================================================
rem  TOOF - deploy helper for Firebase Hosting + Firestore rules
rem  Run: double-click this file
rem  If moved out of the game folder, run with a path:
rem    "update game.bat" "C:\Users\danii\Documents\My Games\3-of-4-main"
rem ============================================================

set "GAME_DIR=%~dp0"
if not "%~1"=="" set "GAME_DIR=%~1"

if not exist "%GAME_DIR%firebase.json" (
    echo.
    echo [ERROR] firebase.json not found in:
    echo   %GAME_DIR%
    echo Pass the game folder, for example:
    echo   "update game.bat" "C:\Users\danii\Documents\My Games\3-of-4-main"
    echo.
    pause
    exit /b 1
)

pushd "%GAME_DIR%"
if errorlevel 1 (
    echo [ERROR] Cannot open the game folder.
    pause
    exit /b 1
)

echo.
echo === 1/2: Updating Firestore rules ===
call firebase deploy --only firestore:rules,firestore:indexes
if errorlevel 1 goto :error

echo.
echo === 2/2: Updating the site ===
call firebase deploy --only hosting
if errorlevel 1 goto :error

echo.
echo [DONE] Game updated. Refresh the page in your browser.
popd
endlocal
pause
exit /b 0

:error
echo.
echo [ERROR] Update failed. See the message above.
popd
endlocal
pause
exit /b 1
