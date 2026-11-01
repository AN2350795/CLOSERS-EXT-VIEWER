# 원본 Glow/HDR와 뷰어 발광 번짐 비교

2026-11-01. 원본 DXBC 5개와 CW.EXE의 Glow 경로를 읽기 전용으로 조사했다. 이번 단계는 비교·감사 도구 추가이며 화면 효과나 기본 설정을 바꾸지 않는다.

## 확인 결과

| 항목 | 원본에서 확인한 내용 | 현재 뷰어 |
| --- | --- | --- |
| 합성 입력 | 기본 화면과 번짐 슬롯 5개. 실제 입력 생성·해상도는 추가 확인 필요 | 켜진 아바타 발광만 추출. 자체 깊이 가림 적용 |
| 흐림 | 가로·세로 각각 9회 샘플. CPU가 전달하는 오프셋·가중치 사용 | 절반 해상도 타깃에서 고정 Gaussian 2패스 |
| 합성 | 모드별 식, 평균·포화 연산 포함 | 기본 RGB에 흐린 발광 RGB × 강도를 더함 |
| 알파 | Glow는 RGBA 전체를 합성 | 기본 화면 알파 보존 |
| HDR | 깊이 G와 화면 밝기를 이용하는 별도 셰이더 존재. 활성 호출 경로는 미확정 | 해당 HDR 계산 없음 |

현재 **빛 번짐**은 발광 부위를 확인하는 뷰어 기능이다. 게임의 빛 번짐 옵션을 그대로 구현한 것으로 간주할 수 없다. 또한 모델의 `_GLOW` 표면 보조광 텍스처는 이 화면 후처리 Glow와 구분한다.

## 원본 셰이더에서 확인한 식

`CW_ScreenQuad_Glow.PS.cso`는 `CBPerGlobal[6].x`의 모드를 확인한다. `p=CBPerGlobal[7].y`, `A=saturate((blur1+…+blur5)/5)`일 때 다음 RGBA 식이다.

- 모드 2: `saturate(A*p + base*(1-saturate(A*p)))`
- 다른 모드: `saturate(5*A + base)`

따라서 모든 모드에서 같은 강도를 곱하는 가산 합성으로 대체할 수 없다. 번짐 단계 수는 CPU에서 최대 5로 제한하지만 실제 실행 중 단계 수와 모드는 아직 확인하지 않았다.

`CW_Blur_Horizon.PS.cso` / `CW_Blur_Vertical.PS.cso`는 `CBPerPostProcess[1..9]`의 X/Y 오프셋과 `[10..18]`의 X/Y 가중치를 각각 사용한다. 각 패스 출력에 포화 연산을 적용한다. 실제 오프셋·가중치와 타깃 크기를 확인하기 전에는 현재 Gaussian과 일치한다고 주장하지 않는다.

`CW_GetBright.PS.cso`는 각 RGBA 채널에 `saturate((input-threshold)/(1-threshold))`를 적용한다. 임계값은 `CBPerPostProcess[19].x`이다. 보관된 구형 FX의 RGB 평균 기반 밝기 추출과 다르므로 최신 DXBC를 기준으로 삼는다. 이 셰이더가 현재 Glow의 입력 생성에 쓰이는지는 추가 확인이 필요하다.

`CW_HDR.PS.cso`는 원본 화면 RGB 합과 깊이 G를 이용해 UV를 `(0.5,0.6)` 방향으로 이동시킨다. 이동량은 `depth.g * sum(source.rgb) * 0.02`이다. 이동한 좌표에서 원본을 다시 읽고 `factor=1-average(source.rgb)`를 계산한다. factor가 음수인 경우에만 minimum으로 바꾼다. 결과 RGB는 `source + bright * power * factor`이며 알파는 다시 읽은 원본값이다. power와 minimum은 `CBPerPostProcess[20].xy`이다. 이 식의 존재만으로 게임 실행 중 HDR이 켜져 있다고 판정하지 않는다.

## 실행 파일 연결 근거

분석한 CW.EXE SHA-256은 `8ea0ce3ba885f3044103c8e071e627b52a0e93cf56cc44b0e03dffed7c440283`이다.

| 주소 | 확인한 연결 |
| --- | --- |
| `0x1416067e6` | ScreenQuad Glow 셰이더 등록 |
| `0x141606a19`, `0x141606a3a` | GetBright / HDR 셰이더 등록 |
| `0x141606b63`, `0x141606b84` | 가로·세로 blur 등록 |
| `0x14157603d` | Glow 경로 호출 후 기존 Edge·ColorGrading 경로로 진행 |
| `0x141572f57` | 번짐 단계 수 최대 5 제한 |
| `0x141572fd7~0x141573004` | 기법 11/12로 blur 체인 호출 |
| `0x141573071`, `0x1415730a3` | Glow 셰이더 그룹 선택과 모드 상수 전달 |
| `0x141573542`, `0x14157376f` | 번짐 슬롯 5개 연결 반복과 최종 quad 그리기 |
| `0x141674a13~0x141674a4e` | 키별 BloomParam 조회, 실패 시 키 0 조회, 전역 상수 기록 |

`GRAPHIC_OPTION_DATA_DETAIL.NTF` 범주 1의 원본 행은 키 0에 수치 약 0.9 / 1.1을 가진다. 감사 보고서는 원본 float32·행·열·해시를 기록한다. 이 수치를 뷰어 번짐 강도나 임계값으로 자동 복사하지 않는다. Glow 셰이더가 직접 읽는 값은 두 번째 성분이다. 첫 번째 성분의 전체 사용 경로는 아직 조사 중이다.

## 재검증

```powershell
cd CLOSERS_Explorer
python tests/audit_bloom.py --workspace ../results --exe 'C:/Program Files (x86)/NaddicGames/Closers/CW.EXE' --output ../diagnostics/bloom-source-20261101.json
python -m unittest discover -s tests -p test_bloom_source.py -v
```

기존 출력 경로 근거 42곳과 추가 Glow 근거 16곳, 셰이더 5개 지문을 검사한다. 원본이 다르거나 중복 출처의 내용이 다르면 검증을 중단한다. 셰이더·게임을 실행하거나 원본을 수정하지 않는다. 로컬 진단 JSON과 디스어셈블 결과는 저장소에 포함하지 않는다.

## 다음 작업

우선 blur 타깃의 생성 크기, 오프셋·가중치 및 샘플러, 발광 MRT를 포함한 입력 연결, 실제 Glow 모드·단계 수를 확인한다. GetBright/HDR 호출과 상수 전달도 별도로 연결해야 한다. 이 근거를 확보한 뒤 원본 방식의 수동 비교 구현 여부를 판단한다.

그 밖에 DOF, 게임 상태값·B 공용 계수·회전·거리 연결, 의상별 인게임 화면 대조가 남아 있다.
