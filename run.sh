function webserver {
    local VALID_PORTS=(3000 3001 4200 4201 5500 5501 8080 8081 5000 5001 8000 8001 1337 8055)
    local SERVE_PATH="./"
    local LAUNCH_FILE="index.html"
    local PORT=""
    local ARGS=("$@")

    local IP_BIND=''
    local CERT=''
    local KEY=''
    local PROTOCOL=''

    for ARG in "${ARGS[@]}"; do
        if [[ "$ARG" =~ ^:?[0-9]+$ ]]; then # If the argument is a number (or a port number) prepend it to VALID_PORTS
            local NEW_PORT="${ARG#:}"
            [[ "$NEW_PORT" -lt 1024 || "$NEW_PORT" -gt 65535 ]] && echo "Invalid port number: $NEW_PORT. Port numbers must be between 1024 and 65535." && return 0;
            VALID_PORTS=("$NEW_PORT" "${VALID_PORTS[@]}")
        elif [[ -d "$ARG" && ! -f "$ARG" ]]; then
            SERVE_PATH="$ARG"
        elif [[ -f "$ARG" && ! -d "$ARG" ]]; then
            #remove the leading / from the argument
            LAUNCH_FILE="$(basename "$ARG")"
        else
            case "$ARG" in
                --ip|-i)
                    IP_BIND="-b $2" && shift 2;;
                --protocol|-p)
                    PROTOCOL="--protocol $2" && shift 2;;
                --cert|-c)
                    CERT="-c $2" && shift 2;;
                --key|-k)
                    KEY="-k $2" && shift 2;;
                *)
                    echo "Invalid argument: $ARG" && return 0;;
            esac
        fi
    done

    for PORTCHK in "${VALID_PORTS[@]}"; do
        [ ! "$(lsof -i :"$PORTCHK" 2>/dev/null)" ] &&  PORT="$PORTCHK" && break
    done

    [[ -z "$PORT" ]] && { printf "\e[31mNo available ports found in VALID_PORTS! All are in use!\e[0m\n"; return 0; }
    [[ ! -d "$SERVE_PATH" ]] && { printf "\e[31mInvalid directory: %s\e[0m\n" "$SERVE_PATH"; return 0; }
    [[ ! -f "$SERVE_PATH$LAUNCH_FILE" ]] && { printf "\e[31mInvalid file: %s\e[0m\n" "$SERVE_PATH$LAUNCH_FILE"; return 0; }
    START_PATH="http://localhost:$PORT/$LAUNCH_FILE"

    if ! eval "python3 -m http.server $PORT $IP_BIND $CERT $KEY $PROTOCOL --directory \"$SERVE_PATH\""; then
        printf "\e[31mFailed to start server on port %s\e[0m\n" "$PORT"
        return 0
    fi
    printf "\e[32mServer started successfully on port %s\e[0m\n" "$PORT"
    echo -e "\e[32mServing $SERVE_PATH$LAUNCH_FILE\e[0m"
    printf "\e[32mTo view the file, open:\e[0m\n\e[34m%s\e[0m\n" "$START_PATH"
    [[ "$LAUNCH_FILE" =~ ^.*\.(html|htm)$ ]] && open "$START_PATH"
    
    return 0;
}

webserver "$@"
