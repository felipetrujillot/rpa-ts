-- Static code. All paths and text arrive as arguments, never as source code.
on resolveDocument(documentPath)
    set hfsPath to (POSIX file documentPath) as text
    tell application "Microsoft Word"
        repeat with candidate in (get documents)
            if full name of candidate is hfsPath then return get contents of candidate
        end repeat
    end tell
    error "WORD_DOCUMENT_NOT_FOUND" number 1006
end resolveDocument

on literalOffset(needle, haystack)
    considering case
        return offset of needle in haystack
    end considering
end literalOffset

on run argv
    set workingPath to item 1 of argv
    set outputPath to item 2 of argv
    set pdfPath to item 3 of argv
    set markerText to item 4 of argv
    set replacementText to item 5 of argv
    set expectedText to item 6 of argv
    set managedDocument to missing value
    try
        tell application "Microsoft Word"
            log "{\"stage\":\"connected\"}"
            set wordVersion to version
            log "{\"stage\":\"inspectingDocuments\"}"
            -- Never use active document; only retain the result of our own open.
            repeat with existingDocument in (get documents)
                if (full name of existingDocument) is ((POSIX file workingPath) as text) then error "WORD_DOCUMENT_CONFLICT" number 1001
            end repeat
            log "{\"stage\":\"opening\"}"
            open (POSIX file workingPath) read only false add to recent files false
            set managedDocument to my resolveDocument(workingPath)
            log "{\"stage\":\"opened\"}"
            if read only of managedDocument then error "WORD_READ_ONLY" number 1002
            log "{\"stage\":\"readOnlyChecked\"}"
            if protection type of managedDocument is not no document protection then error "WORD_PROTECTED" number 1003
            log "{\"stage\":\"protectionChecked\"}"
            set replacementCount to 0
            set nextStart to 0
            repeat
                set bodyText to content of text object of managedDocument
                if nextStart ≥ (count characters of bodyText) then exit repeat
                set tailText to text (nextStart + 1) thru -1 of bodyText
                set markerOffset to my literalOffset(markerText, tailText)
                if markerOffset is 0 then exit repeat
                set matchStart to nextStart + markerOffset - 1
                set bodyRange to create range managedDocument start matchStart end (matchStart + (count characters of markerText))
                log "{\"stage\":\"writing\"}"
                set content of bodyRange to replacementText
                set nextStart to matchStart + (count characters of replacementText)
                set replacementCount to replacementCount + 1
                if replacementCount > 2 then error "WORD_UNEXPECTED_MATCH_COUNT" number 1004
            end repeat
            if replacementCount is not 2 then error "WORD_UNEXPECTED_MATCH_COUNT" number 1004
            log "{\"stage\":\"replaced\",\"matches\":2}"
            log "{\"stage\":\"saving\"}"
            save as managedDocument file name outputPath file format format document
            set managedDocument to my resolveDocument(outputPath)
            log "{\"stage\":\"saved\"}"
            log "{\"stage\":\"exporting\"}"
            save as managedDocument file name pdfPath file format format PDF
            log "{\"stage\":\"exported\"}"
            close managedDocument saving no
            set managedDocument to missing value
            log "{\"stage\":\"closed\"}"
            log "{\"stage\":\"reopening\"}"
            open (POSIX file outputPath) read only true add to recent files false
            set managedDocument to my resolveDocument(outputPath)
            set observedText to content of text object of managedDocument
            -- Word uses CR and includes a final paragraph terminator.
            set AppleScript's text item delimiters to linefeed
            set expectedParagraphs to text items of expectedText
            set AppleScript's text item delimiters to return
            set expectedWordText to (expectedParagraphs as text) & return
            set AppleScript's text item delimiters to ""
            if observedText is not expectedWordText then error "WORD_REOPEN_CONTENT_MISMATCH" number 1005
            close managedDocument saving no
            set managedDocument to missing value
            log "{\"stage\":\"completed\"}"
            return wordVersion
        end tell
    on error errorMessage number errorNumber
        if managedDocument is not missing value then
            try
                tell application "Microsoft Word" to close managedDocument saving no
                log "{\"stage\":\"cleanupCompleted\"}"
            on error
                log "{\"stage\":\"cleanupIncomplete\"}"
            end try
        end if
        error errorMessage number errorNumber
    end try
end run
