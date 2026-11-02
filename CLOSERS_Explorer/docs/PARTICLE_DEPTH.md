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

일반 3D 평면 파티클의 선택 경로와 상태 생성은 아래 추가 조사에서 연결했다. 마스크·메시·Spine/FBX 및 다른 draw 경로, 실제 실행 중의 타깃 연결·상수 덮어쓰기는 아직 남아 있다. `SIMPLE`을 포함한 모든 파티클이 DOF에 참여한다거나, QUAD의 모든 draw가 MRT2를 갱신한다고 결론 내리지 않는다.

## 일반 3D 평면의 상태 전달 추가 조사 (2026-11-03)

`tests/audit_particle_render_state.py`는 설치 `CW.EXE`의 지문과 명령 바이트 **20곳**을 확인한다. 분석에 사용한 디스어셈블러는 게임 파일을 읽기만 하며, 재검증 도구는 별도 디스어셈블러 설치 없이 실행할 수 있다.

| 연결 | 확인한 주소와 내용 |
| --- | --- |
| 종류 | `0x14185d09c`부터 PCT_3D_PLANE=0, PCT_2D_PLANE=1, PCT_MESH=2 등록. 로더는 `+0x94`에 저장 |
| 깊이 플래그 | `0x1415c17d9`에서 검사/쓰기를 템플릿 `+0x354/+0x355`에 읽음 |
| 깊이 전달 | `0x1415b9625`에서 2D 평면은 검사를 끄고, 나머지는 템플릿 검사값을 사용. 쓰기는 템플릿값을 유지해 `0x141615a70`에 전달 |
| 그리기 분기 | `0x1415b96eb`에서 종류 0은 `0x1415b5670`으로 호출 |
| 셰이더 선택 | `0x1415b56c4`의 선택 자원 `+0x438`이 없으면 `0x1415feff0`을 호출해 그룹 4 선택. 있으면 별도 그룹 5 경로 |
| 파일 등록 | `0x1416065b7`에서 그룹 4 슬롯에 CW_Quad.PS.cso 연결 |
| RGB 계수 전달 | `0x1415b9540`에서 템플릿 `+0xf0/+0xf4`를 블렌드 설명에 복사. `0x141615ad0` → `0x14161bed0`으로 상태 생성 |
| 쓰기 마스크 | 호출 전 `0x14060aaf0`이 8개 타깃 설명의 마스크를 0xF로 초기화. 조사한 재작성 분기는 이 마스크를 변경하지 않음 |

이는 조사한 정상 경로의 정적 연결이다. 모든 파티클에 같은 셰이더·상태가 선택되거나 실행 중 MRT2가 항상 연결된다는 뜻은 아니다. 메시·선택 자원·다른 호출 인자에 따른 분기도 같은 경로로 간주하지 않는다.

### RGB와 심도 입력의 블렌딩 분리

`0x14161beee~0x14161bf5e`의 분기는 다음 소스/대상 RGB 계수 쌍에서 IndependentBlendEnable을 켠다.

- SRCALPHA / DESTALPHA (5 / 7)
- SRCALPHA / ONE (5 / 2)
- ZERO / INVSRCCOLOR (1 / 4)
- ONE / ONE (2 / 2)

이때 타깃 1의 RGB 계수는 타깃 0에서 복사하고, 타깃 2의 RGB 계수는 **SRCALPHA / INVSRCALPHA (5 / 6)**로 바꾼다. 일반 SRCALPHA / INVSRCALPHA는 재작성 분기를 건너뛰고, 초기화된 IndependentBlendEnable=0에 따라 타깃 0의 설명이 적용된다. 따라서 가산 RGB 효과를 MRT2에서도 가산으로 계산하는 것은 이 경로와 맞지 않는다.

설명 생성자는 RGB·알파 연산을 ADD=1, 알파 계수를 ONE / ONE=2 / 2로 초기화한다. 이것은 뷰어의 투명 배경 커버리지용 ONE / INVSRCALPHA와 다르다. MRT2 알파를 뷰어의 커버리지 알파로 그대로 대체하지 않는다.

재작성 분기는 공유 float `0x142f9ac94`와 `0x142f9ab14`에도 1을 기록한다. **분기를 건너뛸 때는 이 구간에서 0을 기록하지 않는다.** 따라서 일반 블렌딩의 알파 모드를 항상 0으로 가정할 수 없다. 두 주소의 전체 초기화·복원과 셰이더 상수 업로드 연결은 추가 확인이 필요하다. 보고서의 `alpha_mode_write=null`은 0이라는 뜻이 아니라 이 호출에서 기록하지 않았다는 뜻이다.

`blend_description()`은 이 생성자와 분기만을 재구성한 독립 계산 자료다. 기본 계수 11×11의 121개 입력에서 재작성 조건·타깃별 계수·쓰기 마스크·분기 생략 시 공유 상태 미확정을 검사한다. 실제 draw의 전체 상태를 읽어온 결과는 아니다.

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
python -m unittest discover -s tests -p test_particle_render_state.py -v
python tests/audit_particle_depth.py --workspace ../results --output ../diagnostics/particle-depth-source.json
python tests/audit_particle_render_state.py --exe 'C:/Program Files (x86)/NaddicGames/Closers/CW.EXE' --output ../diagnostics/particle-render-state.json
```

일반 3D 평면의 셰이더 선택·쓰기 마스크·블렌딩 전달을 확인했다. 다음은 확인한 MRT2 분기와 두 가지 알파 모드를 명시한 GPU 비교를 만들어 깊이 합성 결과를 대조하는 것이다. 공유 상수 초기화/복원과 실제 타깃 연결을 더 확인한 뒤 파티클 자체의 심도 적용 범위를 결정한다. 이번 조사로 메뉴·저장값·깊이 기본값을 바꾸지 않았다.
