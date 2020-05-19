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