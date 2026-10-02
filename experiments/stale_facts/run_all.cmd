@echo off
rem E46 end to end, detached from the agent's background time limit.
cd /d D:\AuraSDK-public\experiments\stale_facts
set PYTHONIOENCODING=utf-8
E:\remy\app\.venv\Scripts\python.exe run.py embed > run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
E:\remy\app\.venv\Scripts\python.exe run.py answer >> run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
E:\remy\app\.venv\Scripts\python.exe run.py analyze >> run.log 2>&1
echo EXIT %errorlevel% >> run.log
