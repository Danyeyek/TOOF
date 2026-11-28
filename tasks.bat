@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  TOOF - task runner for repeatable project tasks.
rem  Double-click for a menu, or run with arguments:
rem    tasks.bat list
rem    tasks.bat help
rem    tasks.bat deploy-rules
rem    tasks.bat all
rem    tasks.bat all -dry
rem    tasks.bat deploy-rules "C:\path\to\game"
rem  If moved out of the game folder, pass the folder with -p
rem  or as the last argument.
rem ============================================================

set "APP=TOOF Tasks"
set "GAME_DIR=%~dp0"
set "MODE=menu"
set "SELECTED="
set "DRY="
set "PAUSE_END="

rem --- task registry -------------------------------------------------
rem  To add a task: append set "TASK_n_*" lines and a :taskXxx label.
rem  TASK_n_AUTO=1 means the task also runs in "all" mode.
set "TASK_COUNT=3"
set "TASK_1_ID=deploy-rules"
set "TASK_1_NAME=Deploy Firestore rules and indexes"
set "TASK_1_LABEL=taskDeployRules"
set "TASK_1_AUTO=1"
set "TASK_2_ID=deploy-site"
set "TASK_2_NAME=Deploy the site to Firebase Hosting"
set "TASK_2_LABEL=taskDeploySite"
set "TASK_2_AUTO=1"
set "TASK_3_ID=update"
set "TASK_3_NAME=Deploy rules + site (full update)"
set "TASK_3_LABEL=taskUpdate"
set "TASK_3_AUTO=0"
rem --------------------------------------------------------------------

goto :parse_args

:parse_args
if "%~1"=="" goto :args_done
set "A=%~1"
if /I "%A%"=="-dry" (
    set "DRY=1"
    shift
    goto :parse_args
)
if /I "%A%"=="-pause" (
    set "PAUSE_END=1"
    shift
    goto :parse_args
)
if /I "%A%"=="-p" (
    set "GAME_DIR=%~2"
    shift
    shift
    goto :parse_args
)
if /I "%A%"=="list" (
    set "MODE=list"
    shift
    goto :parse_args
)
if /I "%A%"=="help" (
    set "MODE=help"
    shift
    goto :parse_args
)
if /I "%A%"=="-h" (
    set "MODE=help"
    shift
    goto :parse_args
)
if /I "%A%"=="/?" (
    set "MODE=help"
    shift
    goto :parse_args
)
if /I "%A%"=="all" (
    set "MODE=all"
    shift
    goto :parse_args
)
if /I "%A%"=="menu" (
    set "MODE=menu"
    shift
    goto :parse_args
)
if exist "%A%\NUL" (
    set "GAME_DIR=%A%"
    shift
    goto :parse_args
)
if not defined SELECTED set "SELECTED=%A%"
shift
goto :parse_args

:args_done
for %%I in ("%GAME_DIR%.") do set "GAME_DIR=%%~fI\"

if not exist "%GAME_DIR%firebase.json" (
    echo.
    echo [ERROR] firebase.json not found in:
    echo   %GAME_DIR%
    echo Pass the game folder, for example:
    echo   tasks.bat deploy-rules "C:\path\to\game"
    if defined PAUSE_END pause
    endlocal
    exit /b 1
)

pushd "%GAME_DIR%"
if errorlevel 1 (
    echo [ERROR] Cannot open the game folder: %GAME_DIR%
    if defined PAUSE_END pause
    endlocal
    exit /b 1
)

if not defined DRY (
    where firebase >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Firebase CLI not found.
        echo Install it with: npm install -g firebase-tools
        echo Or run with -dry to see the commands without executing them.
        popd
        if defined PAUSE_END pause
        endlocal
        exit /b 1
    )
)

if "%MODE%"=="list" goto :do_list
if "%MODE%"=="help" goto :do_help
if "%MODE%"=="all" goto :do_all
if defined SELECTED goto :do_one
goto :menu

:do_list
echo %APP% - available tasks
echo.
for /L %%i in (1,1,%TASK_COUNT%) do echo  !TASK_%%i_ID!  -  !TASK_%%i_NAME!
echo.
echo Run: tasks.bat ^<task-id^>   or   tasks.bat all
popd
if defined PAUSE_END pause
endlocal
exit /b 0

:do_help
echo %APP% - automatic execution of project tasks
echo.
echo Usage:
echo   tasks.bat                 interactive menu
echo   tasks.bat list            show task ids
echo   tasks.bat deploy-rules    run one task
echo   tasks.bat all             run all auto tasks
echo   tasks.bat all -dry        print commands without running them
echo   tasks.bat ^<task^> ^<path^>  use another game folder
echo   tasks.bat -p ^<path^> ^<task^>  same, explicit option
echo.
for /L %%i in (1,1,%TASK_COUNT%) do echo  !TASK_%%i_ID!  -  !TASK_%%i_NAME!
popd
if defined PAUSE_END pause
endlocal
exit /b 0

:do_all
call :runAll
set "RC=!ERRORLEVEL!"
popd
if defined PAUSE_END pause
endlocal & exit /b %RC%

:do_one
set "FOUND="
set "RC=0"
for /L %%i in (1,1,%TASK_COUNT%) do (
    if /I "!SELECTED!"=="!TASK_%%i_ID!" (
        set "FOUND=1"
        call :runOne "!TASK_%%i_ID!" "!TASK_%%i_NAME!" "!TASK_%%i_LABEL!"
        set "RC=!ERRORLEVEL!"
    )
)
if not defined FOUND (
    echo [ERROR] Unknown task: !SELECTED!
    echo Run "tasks.bat list" to see available tasks.
    popd
    if defined PAUSE_END pause
    endlocal
    exit /b 1
)
popd
if defined PAUSE_END pause
endlocal & exit /b %RC%

:runAll
set /a FAILED=0
set /a RAN=0
for /L %%i in (1,1,%TASK_COUNT%) do (
    if "!TASK_%%i_AUTO!"=="1" (
        call :runOne "!TASK_%%i_ID!" "!TASK_%%i_NAME!" "!TASK_%%i_LABEL!"
        if errorlevel 1 set /a FAILED+=1
        set /a RAN+=1
    )
)
echo.
echo [SUMMARY] !RAN! task(s) run, !FAILED! failed.
if !FAILED! gtr 0 exit /b 1
exit /b 0

:runOne
echo.
echo === %~2 ===
call :%~3
if errorlevel 1 (
    echo [FAIL] %~1
    exit /b 1
)
echo [OK] %~1
exit /b 0

:menu
cls
echo %APP%
echo Folder: %CD%
if defined DRY echo Mode: DRY RUN (commands are printed, not executed)
echo.
for /L %%i in (1,1,%TASK_COUNT%) do echo   %%i^) !TASK_%%i_NAME!
echo   A^) Run all auto tasks
echo   L^) List task ids
echo   Q^) Quit
echo.
set "CHOICES="
for /L %%i in (1,1,%TASK_COUNT%) do set "CHOICES=!CHOICES!%%i"
set "CHOICES=!CHOICES!ALQ"
choice /C !CHOICES! /N /M "Select: "
set "C=!ERRORLEVEL!"
if !C! GTR !TASK_COUNT! goto :menu_action
for /L %%i in (1,1,%TASK_COUNT%) do (
    if "!C!"=="%%i" set "SELECTED=!TASK_%%i_ID!"
)
goto :menu_run

:menu_action
set /a ACTION=!C!-!TASK_COUNT!
if !ACTION!==1 goto :menu_all
if !ACTION!==2 goto :menu_list
goto :menu_end

:menu_run
for /L %%i in (1,1,%TASK_COUNT%) do (
    if /I "!SELECTED!"=="!TASK_%%i_ID!" (
        call :runOne "!TASK_%%i_ID!" "!TASK_%%i_NAME!" "!TASK_%%i_LABEL!"
    )
)
echo.
pause
goto :menu

:menu_all
call :runAll
echo.
pause
goto :menu

:menu_list
echo.
for /L %%i in (1,1,%TASK_COUNT%) do echo  !TASK_%%i_ID!  -  !TASK_%%i_NAME!
echo.
pause
goto :menu

:menu_end
popd
endlocal
exit /b 0

rem --- task implementations ------------------------------------------

:taskDeployRules
echo   Command: firebase deploy --only firestore:rules,firestore:indexes
if defined DRY exit /b 0
call firebase deploy --only firestore:rules,firestore:indexes
if errorlevel 1 exit /b 1
exit /b 0

:taskDeploySite
echo   Command: firebase deploy --only hosting
if defined DRY exit /b 0
call firebase deploy --only hosting
if errorlevel 1 exit /b 1
exit /b 0

:taskUpdate
call :taskDeployRules
if errorlevel 1 exit /b 1
call :taskDeploySite
if errorlevel 1 exit /b 1
exit /b 0
