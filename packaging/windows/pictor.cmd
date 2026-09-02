@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "PICTOR_INSTALLATION_ROOT=%%~fI"
set "PICTOR_GUI_BINARY=%PICTOR_INSTALLATION_ROOT%\Pictor.exe"
set "PICTOR_RESOURCES=%PICTOR_INSTALLATION_ROOT%\resources"
set "PICTOR_PACKAGE_ROOT=%PICTOR_RESOURCES%\app.asar"
set "PICTOR_BUNDLED_PLUGINS_DIRECTORY=%PICTOR_RESOURCES%\bundled-plugins"

if not exist "%PICTOR_GUI_BINARY%" (
  >&2 echo Pictor GUI binary is missing: %PICTOR_GUI_BINARY%
  exit /b 1
)
if not exist "%PICTOR_PACKAGE_ROOT%" (
  >&2 echo Pictor package archive is missing: %PICTOR_PACKAGE_ROOT%
  exit /b 1
)
if not exist "%PICTOR_BUNDLED_PLUGINS_DIRECTORY%\pictor.agent-workspace\manifest.json" (
  >&2 echo Pictor Bundled Plugin directory is missing: %PICTOR_BUNDLED_PLUGINS_DIRECTORY%
  exit /b 1
)

set "PICTOR_PACKAGED=1"
set "PICTOR_INSTALLATION_ROOT=%PICTOR_INSTALLATION_ROOT%"

if /I "%~1"=="cli" (
  shift
  set "PICTOR_FRONTEND=cli"
  set "ELECTRON_RUN_AS_NODE=1"
  set "PICTOR_ENTRY=%PICTOR_PACKAGE_ROOT%\out\cli\src\cli\entry.js"
  goto :run_node
)
if /I "%~1"=="tui" (
  shift
  set "PICTOR_FRONTEND=tui"
  set "ELECTRON_RUN_AS_NODE=1"
  set "PICTOR_ENTRY=%PICTOR_PACKAGE_ROOT%\out\tui\src\tui\entry.js"
  goto :run_node
)

set "PICTOR_FRONTEND=gui"
set "ELECTRON_RUN_AS_NODE="
"%PICTOR_GUI_BINARY%" %*
exit /b %ERRORLEVEL%

:run_node
set "PICTOR_ARGS="
:collect_node_args
if "%~1"=="" goto :invoke_node
set "PICTOR_ARGS=%PICTOR_ARGS% %1"
shift
goto :collect_node_args

:invoke_node
"%PICTOR_GUI_BINARY%" "%PICTOR_ENTRY%"%PICTOR_ARGS%
exit /b %ERRORLEVEL%
