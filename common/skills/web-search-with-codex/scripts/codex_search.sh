#!/bin/bash

# Web Search with Codex
# Usage: codex_search.sh [-m model] "search query"
#
# Options:
#   -m MODEL  Specify the model to use (default: gpt-5.2-codex)
#
# This script executes codex with the given query and returns only the final response,
# filtering out thinking/reasoning steps.

set -euo pipefail

# Model option (empty by default, uses codex default)
MODEL=""

# Parse options
while getopts ":m:" opt; do
    case $opt in
        m)
            MODEL="$OPTARG"
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
        :)
            echo "Option -$OPTARG requires an argument." >&2
            exit 1
            ;;
    esac
done
shift $((OPTIND - 1))

if [ $# -eq 0 ]; then
    echo "Usage: $0 [-m model] \"search query\"" >&2
    echo "  -m MODEL  Specify the model to use (default: codex default)" >&2
    exit 1
fi

# Build model option
MODEL_OPT=""
if [ -n "$MODEL" ]; then
    MODEL_OPT="-m $MODEL"
fi

QUERY="$1"

# Check if required commands are available
if ! command -v codex &> /dev/null; then
    echo "Error: codex CLI is not installed or not in PATH" >&2
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed or not in PATH" >&2
    exit 1
fi

# Execute codex and process the JSON output
# The --json flag outputs JSON Lines format with various event types
# We filter for item.completed events and extract the final message content
codex exec --skip-git-repo-check $MODEL_OPT --json "WebSearch: $QUERY" 2>/dev/null | \
    jq -rs '
        # Filter for agent_message items (excluding reasoning and other types)
        [.[] | select(
            .type == "item.completed" and
            .item.type == "agent_message"
        )]
        # Get the last message
        | last
        # Extract the text content
        | .item.text
    ' 2>/dev/null || {
        # Fallback: if jq parsing fails, try a simpler approach
        codex exec --skip-git-repo-check $MODEL_OPT "WebSearch: $QUERY" 2>/dev/null
    }
