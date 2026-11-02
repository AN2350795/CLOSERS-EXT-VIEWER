# 파티클 깊이 기록과 심도 적용 근거

현재 파티클은 원본 정의의 깊이 검사·쓰기와 RGB 블렌딩 설정을 사용한다. 파티클 자체의 DOF 깊이 출력은 아직 구현하지 않았다. 하드웨어 깊이 버퍼 기록과 DOF가 읽는 색상 MRT2 출력은 별개이며, 두 경로를 같은 플래그로 켜지 않는다.

## 원본에서 확인한 출력

설치 아카이브의 DXBC를 Windows `D3DDisassemble`로 읽었다. 게임·Lua·원본 셰이더를 실행하지 않았다. 재검증 도구 `tests/audit_particle_depth.py`는 원본 파일 해시와 DXBC 출력 시그니처를 확인한다.

| 셰이더 | 출력 시그니처 | 확인한 범위 |
| --- | --- | --- |
| `CW_QUAD.PS.CSO` | SV_Target 0·1·2 | `v3.z`, `CBPerGlobal[8]`로 기존 DOF와 같은 초점 기준 깊이를 MRT2 RGB에 기록 |
| `CW_NOLIGHT.PS.CSO` | SV_Target 0·1·2 | `v6.z`, `CBPerGlobal[8]`로 같은 깊이 수식을 사용 |
| `CW_SIMPLE.PS.CSO` | SV_Target 0 | 이 셰이더의 출력 시그니처에는 MRT2가 없음 |

QUAD는 `cb6[0].y == 1`, NOLIGHT는 `cb5[19].y == 1` 조건에 따라 MRT2 알파를 표면 알파 또는 표면 알파×최종 색 R로 선택한다. QUAD에는 저알파 색상을 0으로 만드는 경로와 별도 dissolve discard도 있다. 따라서 MRT2에 깊이 수식을 출력한다는 사실만으로 커버리지 알파를 1로 정하거나 하드웨어 깊이 기록 여부를 결정할 수 없다. 출력 시그니처 역시 실행 중 해당 타깃이 연결되고 쓰기 마스크가 켜져 있다는 증거는 아니다.

각 파티클에 어떤 셰이더가 선택되는지, MRT2에 적용되는 쓰기 마스크·블렌딩, 위 상수의 실제 값은 아직 연결하지 않았다. `SIMPLE`을 포함한 모든 파티클이 DOF에 참여한다거나, QUAD의 모든 draw가 MRT2를 갱신한다고 결론 내리지 않는다.

## 실제 정의와 뷰어 정규화

아래 네 항목은 저장된 파생 인덱스에 의존하지 않고 원본 Lua 정의를 다시 읽어 대조했다. 두 Lua 파일의 해시도 감사 도구에서 확인한다.

| 정의 | 원본 깊이 검사/쓰기 | 뷰어 검사/쓰기 | RGB 블렌딩 |
| --- | --- | --- | --- |
| `FOOT_DUST` (`PARTICLE_SYSTEM_MAIN.LUA`) | 둘 다 생략 | 켜짐/꺼짐 | SRCALPHA / INVSRCALPHA |
| `PE_TRANSFORM_SYSTEM_CORE_GLOW_01` (동일 파일) | FALSE / TRUE | 꺼짐/켜짐 | SRCALPHA / DESTALPHA |
| `PE_CUSTOM_EF_FLOOR_WATER_WAVE` (`PARTICLE_SYSTEM_MAIN_EF1.LUA`) | 둘 다 생략 | 켜짐/꺼짐 | SRCALPHA / ONE |
| `PE_2026_SUMMER_DANCE_EMOTION_BG_NEON_SIGN` (동일 파일) | TRUE / TRUE | 켜짐/켜짐 | SRCALPHA / INVSRCALPHA |

생략된 값은 현재 뷰어의 기본 처리다. 이를 게임 엔진의 생성자 기본값까지 확인한 것으로 표시하지 않는다. 깊이 검사 꺼짐/쓰기 켜짐이라는 명시적인 조합도 그대로 보존한다.

## 뷰어 GPU 검증

`test_particle_depth_browser.py`는 `createParticleModel()`의 실제 InstancedMesh·입자별 알파 셰이더를 실행한다. 일반/가산 블렌딩 × 깊이 검사 켜기/끄기 × 깊이 쓰기 켜기/끄기 × 알파 0/0.5의 **16개 조건**에서 나중에 그리는 뒤쪽 표면이 가려지는지 대조한다.

- 깊이 검사·쓰기가 모두 켜지고 유효 알파가 있는 입자만 뒤쪽 표면을 가렸다. 검사 꺼짐/쓰기 켜짐은 이 WebGL 경로에서 깊이 가림을 만들지 않았다.
- 부분 알파도 깊이 쓰기가 켜지면 살아남은 픽셀의 깊이는 기록했다. 투명도를 곱한 깊이로 바꾸지 않는다.
- 텍스처의 완전히 투명한 부분은 뷰어의 알파 테스트로 제외되어 뒤쪽 표면을 가리지 않았다. 이 낮은 알파 컷오프는 기존 뷰어 처리이며 원본 QUAD의 색상 0 처리와 동일한 동작이라고 주장하지 않는다.
- 반투명·가산 입자를 불투명 보조 모델용 가림 목록에 전달해도 아바타 DOF 깊이에 임의로 포함하지 않는다. 깊이 준비 전후의 일반 파티클 출력도 픽셀 단위로 같아야 한다.

이 검사는 통제된 형상·텍스처와 현재 WebGL 렌더러의 동작을 검증한다. 원본 게임의 MRT2 블렌딩·깊이 상태나 인게임 화면과의 일치를 입증하지 않는다.

## 재검증과 다음 단계

```powershell
cd CLOSERS_Explorer
python -m unittest discover -s tests -p test_particle_depth_source.py -v
python -m unittest discover -s tests -p test_particle_depth_browser.py -v
python tests/audit_particle_depth.py --workspace ../results --output ../diagnostics/particle-depth-source.json
```

다음은 파티클 draw의 셰이더 선택과 MRT2 쓰기 마스크·블렌딩 연결을 확인하는 것이다. 그 근거를 확보한 뒤 파티클 자체의 심도 적용 범위를 결정한다. 이번 조사로 메뉴·저장값·깊이 기본값을 바꾸지 않았다.
