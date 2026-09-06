@echo off
rem run.bat - cmd.exe entry point. Delegates to the native run.ps1 (no Git Bash /
rem WSL needed, only Docker Desktop). Env vars (RESUME, ...) pass through.
rem
rem   run.bat test
rem   set RESUME=1 && run.bat e2e
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
exit /b %errorlevel%
