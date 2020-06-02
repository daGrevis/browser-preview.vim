if exists('g:loaded_BrowserPreview')
    finish
endif

let g:loaded_BrowserPreview = 1

let s:plugin_root = expand('<sfile>:p:h:h')

function! s:start()
    if exists('s:job')
        return
    endif

    let l:args = ['node', './node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/server/index.ts']

    function! s:onExit(chanId, data, name) abort
        if exists('s:job')
            unlet s:job
        endif
    endfunction

    function! s:onStderr(chanId, data, name) abort
        let l:has_error = 0

        for line in a:data
            if line != ''
                if l:has_error == 0
                    echom 'browser-preview.vim errored'
                endif

                let l:has_error = 1

                echom line
            endif
        endfor
    endfunction

    let l:job = jobstart(l:args, {
                \ 'cwd': s:plugin_root,
                \ 'rpc': v:true,
                \ 'on_exit': function('s:onExit'),
                \ 'on_stderr': function('s:onStderr'),
                \ })

    if l:job == -1
        echom 'browser-preview.vim failed to start'
        return
    endif

    let s:job = l:job
endfunction

function! s:update()
    if !exists('s:job')
    echom 'browser-preview.vim not started'
        return
    endif

    let l:lines = getline(1, '$')

    call rpcnotify(s:job, 'update', {
                \ 'filepath': expand('%:p'),
                \ 'lines': l:lines,
                \ 'cursor': getcurpos(),
                \ 'renderer': get(g:BrowserPreview, 'renderer', ''),
                \ 'styles': get(g:BrowserPreview, 'styles', []),
                \ 'className': get(g:BrowserPreview, 'className', ''),
                \ })
endfunction

function! s:stop()
    if !exists('s:job')
        echom 'browser-preview.vim not started'
        return
    endif

    let l:status = jobstop(s:job)

    if l:status == 0
        echom 'browser-preview.vim failed to stop'
    endif
endfunction

function! s:BrowserPreview(...)
    if a:0 == 0
        call s:start()
        call s:update()
    elseif a:1 == 'start'
        call s:start()
    elseif a:1 == 'update'
        call s:update()
    elseif a:1 == 'stop'
        call s:stop()
    endif
endfunction

command! -nargs=* BrowserPreview call s:BrowserPreview(<f-args>)
