#!/bin/bash
# lib/tap-parser.sh - Parse TAP14 output from test client log files
#
# Extracts pass/fail/skip counts from TAP version 14 output.
# Falls back to legacy checkmark (✓/✗) parsing if no TAP version line is found.
#
# Usage:
#   source lib/tap-parser.sh
#   parse_tap_file "path/to/logfile.log"
#   echo "passed=$TAP_PASSED failed=$TAP_FAILED skipped=$TAP_SKIPPED total=$TAP_TOTAL"
#   echo "format=$TAP_FORMAT"  # "tap14" or "legacy"

# Parse a log file and set TAP_PASSED, TAP_FAILED, TAP_SKIPPED, TAP_TOTAL, TAP_FORMAT.
#
# Returns 0 if any test results were found, 1 if the file has no parseable results.
parse_tap_file() {
    local file="$1"

    # Reset counters
    TAP_PASSED=0
    TAP_FAILED=0
    TAP_SKIPPED=0
    TAP_TOTAL=0
    TAP_FORMAT="unknown"

    if [ ! -f "$file" ]; then
        return 1
    fi

    # Check if this is TAP output by looking for the version line.
    # The version line may not be the very first line of the file since
    # docker/make output may precede it, so scan the whole file.
    if grep -q "^TAP version 1[34]" "$file" 2>/dev/null; then
        TAP_FORMAT="tap14"
        _parse_tap "$file"
    elif grep -q "^[✓✗]" "$file" 2>/dev/null; then
        TAP_FORMAT="legacy"
        _parse_legacy "$file"
    else
        return 1
    fi

    TAP_TOTAL=$((TAP_PASSED + TAP_FAILED + TAP_SKIPPED))
    return 0
}

# Parse TAP14 (or TAP13) format
_parse_tap() {
    local file="$1"

    # Count "ok" lines (pass or skip) and "not ok" lines (fail or todo)
    # Only match top-level test points (not indented subtests).
    # TAP lines: ^ok or ^not ok
    # We need to separate SKIP and TODO directives.

    while IFS= read -r line; do
        # Skip indented lines (subtests are 4-space indented)
        case "$line" in
            "    "*) continue ;;
        esac

        if [[ "$line" =~ ^ok\ [0-9]+ ]] || [[ "$line" =~ ^ok\ -\  ]] || [[ "$line" =~ ^ok$ ]]; then
            # Check for SKIP directive (case-insensitive)
            if echo "$line" | grep -qi ' # SKIP'; then
                TAP_SKIPPED=$((TAP_SKIPPED + 1))
            else
                TAP_PASSED=$((TAP_PASSED + 1))
            fi
        elif [[ "$line" =~ ^not\ ok ]]; then
            # "not ok" with TODO directive counts as a todo, not a failure
            if echo "$line" | grep -qi ' # TODO'; then
                # TODO tests are not failures per TAP spec.
                # Count them as passed for now (they're expected to fail).
                TAP_PASSED=$((TAP_PASSED + 1))
            else
                TAP_FAILED=$((TAP_FAILED + 1))
            fi
        fi
    done < "$file"
}

# Parse legacy checkmark format (fallback)
_parse_legacy() {
    local file="$1"
    TAP_PASSED=$(grep -c "^✓" "$file" 2>/dev/null) || TAP_PASSED=0
    TAP_FAILED=$(grep -c "^✗" "$file" 2>/dev/null) || TAP_FAILED=0
}
