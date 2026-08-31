# TURN Relay-Only Acceptance Record

自动 TURN allocation 通过只证明服务端能分配 relay candidate；它不证明两台真实客户端在不同运营商/NAT 下能持续通话。发布前必须填写并由 approver 签字。

| Field | Value |
|---|---|
| Deployment version / commit | |
| TURN host and probe timestamp (UTC) | |
| Device A and client version | |
| Device B and client version | |
| Physical network A (carrier/Wi-Fi) | |
| Physical network B (distinct carrier/Wi-Fi) | |
| Forced relay policy enabled | yes / no |
| Selected candidate pair and candidate type | |
| Bidirectional audio/video call completed | yes / no |
| Background/foreground transition verified | yes / no |
| Network switch during call verified | yes / no |
| Result and notes | |
| Approver and date | |

Do not mark this record complete from the automated allocation probe alone.
