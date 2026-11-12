use framework "Foundation"
use scripting additions
property mutationStarted : false

on jsonValue(dict, key)
    return dict's objectForKey:key
end jsonValue

on equalText(a, b)
    return ((current application's NSString's stringWithString:a)'s isEqualToString:b) as boolean
end equalText

on resolveDocument(documentPath)
    set hfsPath to (POSIX file documentPath) as text
    tell application "Microsoft Word"
        repeat with candidate in (get documents)
            if full name of candidate is hfsPath then return get contents of candidate
        end repeat
    end tell
    error "WORD_DOCUMENT_NOT_FOUND"
end resolveDocument

on performAction(actionName, params)
    set documentPath to (my jsonValue(params, "documentPath")) as text
    set hfsPath to (POSIX file documentPath) as text
    set resultDict to current application's NSMutableDictionary's dictionary()
    tell application "Microsoft Word"
        if actionName is "word.document.open" then
            repeat with candidate in (get documents)
                if full name of candidate is hfsPath then error "WORD_DOCUMENT_CONFLICT"
            end repeat
            set my mutationStarted to true
            set previousSecurity to automation security
            set automation security to 3
            try
                open (POSIX file documentPath) read only false add to recent files false
                set automation security to previousSecurity
            on error openMessage number openNumber
                set automation security to previousSecurity
                error openMessage number openNumber
            end try
            set targetDocument to my resolveDocument(documentPath)
            resultDict's setObject:(version as text) forKey:"wordVersion"
            return resultDict
        end if
        set targetDocument to my resolveDocument(documentPath)
        if actionName is "word.document.readText" then
            resultDict's setObject:(content of text object of targetDocument) forKey:"text"
            return resultDict
        end if
        if actionName is "word.document.close" then
            set policy to (my jsonValue(params, "changes")) as text
            if policy is "rejectIfDirty" and not (saved of targetDocument) then error "WORD_DOCUMENT_DIRTY"
            set my mutationStarted to true
            if policy is "save" then
                close targetDocument saving yes
            else
                close targetDocument saving no
            end if
            resultDict's setObject:true forKey:"closed"
            return resultDict
        end if
        if read only of targetDocument then error "WORD_READ_ONLY"
        if protection type of targetDocument is not no document protection then error "WORD_PROTECTED"
        if actionName is "word.document.applyEdits" then
            set observedText to content of text object of targetDocument
            if not (my equalText(observedText, (my jsonValue(params, "expectedText")) as text)) then error "WORD_DOCUMENT_CHANGED"
            set edits to my jsonValue(params, "edits")
            repeat with editIndex from 0 to ((edits's |count|()) as integer) - 1
                set editItem to edits's objectAtIndex:editIndex
                set startIndex to (my jsonValue(editItem, "start")) as integer
                set endIndex to (my jsonValue(editItem, "end")) as integer
                set newText to (my jsonValue(editItem, "text")) as text
                set targetRange to create range targetDocument start startIndex end endIndex
                set my mutationStarted to true
                set content of targetRange to newText
            end repeat
            return resultDict
        end if
        set destinationPath to (my jsonValue(params, "path")) as text
        if actionName is "word.document.saveAs" then
            set my mutationStarted to true
            save as targetDocument file name destinationPath file format format document
            resultDict's setObject:destinationPath forKey:"path"
            return resultDict
        end if
        if actionName is "word.document.exportPdf" then
            set my mutationStarted to true
            save as targetDocument file name destinationPath file format format PDF
            resultDict's setObject:destinationPath forKey:"path"
            return resultDict
        end if
        error "WORD_UNKNOWN_ACTION"
    end tell
end performAction

on run
    set stdinHandle to current application's NSFileHandle's fileHandleWithStandardInput()
    set stdoutHandle to current application's NSFileHandle's fileHandleWithStandardOutput()
    repeat
        set buffer to current application's NSMutableData's alloc()'s init()
        repeat
            set chunk to stdinHandle's availableData()
            if (chunk's |length|()) as integer is 0 then exit repeat
            buffer's appendData:chunk
            set lineText to current application's NSString's alloc()'s initWithData:buffer encoding:(current application's NSUTF8StringEncoding)
            if lineText is not missing value then
                if (lineText's hasSuffix:linefeed) as boolean then exit repeat
            end if
        end repeat
        if (buffer's |length|()) as integer is 0 then exit repeat
        set response to current application's NSMutableDictionary's dictionary()
        set my mutationStarted to false
        try
            set request to current application's NSJSONSerialization's JSONObjectWithData:buffer options:0 |error|:(missing value)
            response's setObject:(my jsonValue(request, "id")) forKey:"id"
            set actionName to (my jsonValue(request, "action")) as text
            set params to my jsonValue(request, "input")
            set outputDict to my performAction(actionName, params)
            response's setObject:true forKey:"ok"
            response's setObject:outputDict forKey:"output"
        on error errorMessage number errorNumber
            response's setObject:false forKey:"ok"
            response's setObject:errorMessage forKey:"error"
            if my mutationStarted then
                response's setObject:"uncertain" forKey:"effect"
            else
                response's setObject:"none" forKey:"effect"
            end if
        end try
        set responseData to current application's NSJSONSerialization's dataWithJSONObject:response options:0 |error|:(missing value)
        stdoutHandle's writeData:responseData
        stdoutHandle's writeData:((current application's NSString's stringWithString:linefeed)'s dataUsingEncoding:(current application's NSUTF8StringEncoding))
    end repeat
end run
