# osc-action

Send Open Sound Control messages as a part of GitHub Actions workflows. Because software development needs beeps and bloops.

```yaml
    - uses: urcomputeringpal/osc-action@master
      with:
        host: localhost
        port: 51235
        endpoint: /run-code
        separator: "|"
        message: ACTIONS|play 60
```

Pairs nicely with [Sonic Pi](https://sonic-pi.net) and [GitHub Actions Self-hosted runners](https://help.github.com/en/actions/hosting-your-own-runners).

# Example

The following workflow will run the contents of `sonic-pi.rb` in your repository in your copy of Sonic Pi every time it is pushed to the `master` branch:

```yaml
name: live
on:
  push:
    branches:
      - master

jobs:
  run-code:
    runs-on: self-hosted
    steps:
    - uses: actions/checkout@v1
    - id: contents
      run: |
        
        # Escape newlines
        escapeData() {
            old_lc_collate=$LC_COLLATE
            LC_COLLATE=C
            local length="${#1}"
            for (( i = 0; i < length; i++ )); do
                local c="${1:i:1}"
                case $c in
                    $'\r') printf "%%0D";;
                    $'\n') printf "%%0A";;
                    *) printf "$c" ;;
                esac
            done
            LC_COLLATE=$old_lc_collate
        }
        
        echo "::set-output name=file::$(escapeData "$(cat sonic-pi.rb)")"
    - uses: urcomputeringpal/osc-action@master
      with:
        host: localhost
        # 
        port: 51235
        endpoint: /run-code
        separator: "|"
        message: ACTIONS|${{ steps.contents.outputs.file }}
 ```
