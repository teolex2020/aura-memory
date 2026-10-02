@echo off
rem E42 end to end, detached from the agent's background time limit.
cd /d D:\AuraSDK-public\experiments\prefeval_checker
set PYTHONIOENCODING=utf-8
python run.py generate > run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
python run.py judge >> run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
python run.py check >> run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
python run.py analyze >> run.log 2>&1
echo EXIT %errorlevel% >> run.log
