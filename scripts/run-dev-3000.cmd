@echo off
setlocal

cd /d "%~dp0.."

set "PORT=3000"
set "NEXTAUTH_URL=http://localhost:3000"

call npm run dev -- --webpack --port %PORT% 1>dev-server.out.log 2>dev-server.err.log
