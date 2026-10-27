# 아바타 재질 조사와 표시 범위

2026-10-24 로컬 게임 원본을 읽어 검증했다. 원본 CMF, CW.EXE, 기존 추출 에셋은 수정하지 않는다.

## 적용 범위

| 입력 | 확인한 의미 | 현재 표시 |
| --- | --- | --- |
| X Material의 power, specular RGB, emissive RGB | X 파일에 보관된 원본 수치 | API에 보존. 게임의 활성 조건 확인 없이 조명 값으로 적용하지 않음 |
| XET m_mapEmissiveMaterial | OrgTexName별 EmissiveTexName, RGBA, fEmissiveStrength | 선택한 아이템의 원본 텍스처에만 발광 미리보기 연결 |
| m_MultiTexName | XET 렌더 경로에서 MatCap으로 바인딩 | 연결 정보·출처 표시. 기존 피부 가산식 제거, 효과 미적용 |
| m_MaskTexName | XET 렌더 경로에서 g_tMaskMap으로 바인딩 | 출처 표시. 모든 재질에 알파 마스크로 적용하지 않음 |
| m_strDyeingMaskTexName | 별도 염색 입력 | 출처 표시, 효과 미적용 |
| m_mapToonTexChange | 아이템의 원본 툰 이름에서 대상 툰 이름으로 변경 | 변경표 보존·표시, 효과 미적용 |
| SpecularColor / SpecularPower | 별도 MatCap 반사 설정의 입력 | 원본 수치 표시, 효과 미적용 |
| 피부 이외 보조 재질 | m_MultiTexName 입력도 아이템별로 보존 | 파일명으로 셰이더를 선택하지 않음. 확인된 발광만 미리보기 |

미지원은 실패한 기본색 로딩과 구분한다. 발광 텍스처가 없거나 출처가 중복이면 기본색과 모델을 유지하고 확인할 항목을 안내한다. 중복 XET에서 새로 보존한 툰·발광 블록이 다르면 해당 효과만 보류한다. 기본색 변경표 자체가 충돌한 경우는 기존 오류 처리를 유지한다.

## 원본 대조

동봉 FX/HLSL과 실제 CSO의 내용이 다르다. `CW_CARTOONLIGHT.PS.CSO`와 `CW_DEFAULT.VS.CSO`를 Windows `D3DDisassemble`로 읽어 최신 경로를 조사했다. 게임 코드는 실행하지 않았다.

- `NKXMESH_RI_BASIC.FX` SHA-256: `a57c8d6339871e75da6bc79868ec293cd8eca5b879df7fcf537cdc16d087cb78`
- `NKXMESH_RI_BASIC_CARTOONLIGHT_PS.HLSL`: `9cf7a95ec2d7e151fd87fed0d43fe57c0223d5e1f18f6f25287fafb9c3f01498`
- `NKXMESH_RI_BASIC_VS.HLSL`: `53a70237f63ac6992a6019d07cb6f5e7954fdf19509d754e7ba99f7d27597b9c`

원본별 CMF·순번·바이트 해시는 아래 감사 스크립트가 기록한다. 로컬 조사본은 `diagnostics/material-source/`, 메타데이터는 `diagnostics/material-audit.json`에 있다. 게임 셰이더 본문은 저장소에 포함하지 않는다.

### MatCap과 반사

최신 CSO의 t13/s12는 `g_tMatCapMap`이다. t1 normal 입력의 RGB 중 하나라도 양수일 때만 이 분기로 진입한다. normal RGB를 [-1,1]로 복원하고 TBN 및 행렬 변환·정규화를 거친 XY를 `(0.5,-0.5)`로 곱하고 0.5를 더해 좌표를 만든다. MatCap RGB에 **normal 맵의 알파**를 곱해 기본색에 더하고 saturate한다. 이어 별도 반사색·지수에 의한 반사를 같은 알파로 제어한다.

정적 실행 파일의 `0x141747e23`은 XET 보조 텍스처를 MatCap 바인딩 함수 `0x1415fee60`에 전달한다. `0x1415fb540`은 원본 normal 리소스 유무도 검사한 뒤 별도 반사 수치를 설정한다. 따라서 m_MultiTexName만 있다는 이유로 이 분기의 활성·기여도를 결정할 수 없다. normal의 자동 연결 규칙, tangent/bitangent 및 런타임 행렬 조건은 아직 완전히 확인하지 않았다.

이전 `diffuse * sphereMap * 0.35`는 이 식과 다르며 원본 근거가 없는 계수였다. 피부에 적용되던 해당 코드를 제거했다. API의 기존 skin-sphere 항목은 출처 호환성을 위해 남기되 `status=unsupported`로 반환하고 렌더러에서는 설치하지 않는다.

### 툰·마스크·염색

최신 VS는 원본 법선과 정규화된 `g_v4DLightDir`의 내적을 툰 UV 두 성분에 넣는다. PS는 이 좌표로 툰 맵을 읽고 cartoon power를 곱해 saturate한다. half-Lambert나 임의의 램프로 대체하지 않았다. 아이템별 툰 변경표만으로 표면의 기본 툰 할당, 게임 조명 방향·세기까지 확정할 수 없다. 일부 변경 대상 이름은 카탈로그의 BMP로도 존재하지 않는다.

구형 FX의 기본 조명 분기는 mask.r을 알파에 곱하지만 최신 Cartoon CSO에는 t6 mask 샘플이 없다. XET의 mask를 모든 표면의 투명도에 곱하면 원본 조건을 무시하게 된다.

최신 염색 분기는 구형 HLSL의 단순 R/G/B 가중합과 다르다. R과 (1-R), B 및 알파를 이용하는 saturate·합성 연산이 있으며 normal 분기와도 배타적이다. 마스크의 채널·실제 염색색·분기 활성 조건을 함께 확인해야 하므로 임의의 염색색을 넣지 않았다.

### 발광

최신 PS는 원본 UV의 t12를 읽고 EmissiveColor와 strength 두 성분을 곱해 **별도 MRT1**에 기록한다. XET의 색·강도 연결은 실행 파일의 `0x141747ef6`~`0x141747f15`에서도 확인된다. 알파 및 게임 후처리·bloom은 별도의 경로다.

현재 미리보기는 `emissiveMap.rgb * XET.color.rgb * XET.strength`를 같은 표면에 더한다. 임의 강도 계수는 없다. UV 반복, 뒤집기, 기본색과 독립된 텍스처 캐시를 사용한다. 게임의 별도 발광 타깃·후처리·두 번째 런타임 strength·색공간과의 일치는 검증하지 않았으므로 **근사 미리보기**다. 알파에는 발광색이나 발광 맵 알파를 곱하지 않으며 기존 ALPHA·눈동자 처리와 alphaTest를 유지한다.

## 이슬라 리트모의 작은 변화에 대한 판단

하피 A타입 신발(25986, `ROGUE:1307012414:0`)의 XET는 피부 표면에 MAT_209_SKIN.PNG를 지정한다. 이 128×128 원본의 채널 범위는 R 0~82, G 0~67, B 0~51, A 255다. 대부분 어둡고 하이라이트가 좁다. 이전 구현은 이를 sRGB에서 선형 변환한 뒤 기본색 및 0.35를 곱했으므로, 샘플 영역에 따라 기존 최대 2/255 수준의 변화가 생긴다는 설명은 가능하다.

그러나 이것은 **기존 근사식에서의 작은 변화**에 대한 설명이다. 인게임 효과가 원래 미세하다는 증거가 아니다. 최신 셰이더가 요구하는 normal/alpha 및 조명 입력을 확인하기 전에는 단일 신발의 MatCap 강도를 단정할 수 없다. 현재는 그 작은 변화를 재현 성공으로 취급하지 않는다.

[공식 아틀리에 안내](https://www.naddic.co.kr/ko/game/cls/notice/detail?contentNo=1230)는 이슬라 리트모 라이트에 7부위 조건을 명시한다. 신발 하나의 XET 보조 재질과 세트 광원효과를 동일시할 수 없다. [공식 GM노트](https://www.naddic.co.kr/ko/game/cls/gmNote/detail?contentNo=1232)의 자료도 동일 캐릭터·타입·카메라·조명에서의 MatCap ON/OFF 기준 화면은 아니므로 수치 대조의 정답으로 사용하지 않았다.

## 검증과 재실행

### 선택형 의상 조명 비교

`조명 · 발광`의 의상 조명은 `LIGHT_CONVERT_TEMPLET.NTF`/`LIGHT_CONVERT_DATA.NTF` 및 `SET_ITEM_EFFECT_TEMPLET.NTF`/`SET_ITEM_UNIT_LIGHT_DATA.NTF`에서 색·방향·강도를 읽는 별도 비교 기능이다. NTF의 type 9 강도는 IEEE 754 float로 해석하며, 한국어 이름은 원본 문자열 키로 연결한다. 착용 조건을 판정한 인게임 조명 자동 적용이라고 표시하지 않는다.

초기 구현은 기본색에 Lambert 항을 곱해 이미 음영이 그려진 텍스처를 다시 어둡게 만들었다. 현재는 `mix(1, color.rgb * intensity, max(dot(worldNormal, lightDirection), 0) * influence)`를 기본색에 곱하는 **수치 비교**로 제한하고 기본 비교 강도를 0.5로 둔다. 게임 좌표의 Z축을 뷰어 좌표에 맞춰 뒤집으며, 일반/다중 가중치 스키닝 법선도 변환한다. 발광의 가산식은 이 계산 이후에 독립적으로 적용한다. 기존 게임 툰 셰이더의 재현이나 미확인 MatCap 분기의 활성화가 아니다. `near_intensity`와 별도 추가 수치는 출처에 보존하지만 확인하지 못한 런타임 보간·후처리에는 사용하지 않는다.

현재 아바타의 확인된 발광 연결은 아이템·원본 텍스처별로 표시하고 각각 제외할 수 있다. 전체 발광 스위치는 이 개별 제외 선택을 유지하며, 조명 OFF는 기본색·발광·투명도를 원래 값으로 복원한다.

### 발광 확인과 선택적 번짐

기본색과 독립된 발광 패스에서 켜진 발광 텍스처만 렌더링한다. 나머지 아바타 표면은 원래 알파·깊이를 유지하는 검은 가림막으로 남긴다. 따라서 흰 기본색이 광원으로 오인되거나 다른 아바타 메시 뒤의 발광이 새어 나오지 않는다. 배경·모션 효과·보조 장식은 이 패스에서 제외한다. 별도 발광 타깃을 가로·세로 Gaussian blur한 뒤 선형 공간에서 원래 화면과 합성한다. 원본 게임 후처리 계수나 런타임 bloom 재현으로 주장하지 않는다.

`발광만 보기`와 확인용 밝기는 실제 발광 부위 확인을 위한 진단 화면이다. 확인용 밝기는 기본 화면의 발광 강도를 바꾸지 않는다. 기본 결과의 일괄 미지원 경고는 제거하고, 미지원 입력은 해당 재질의 상세 정보에 남긴다. 설치된 휠 오브 트리니티 6부위와 리어윙의 실제 모델·텍스처로 표면/번짐/발광만/발광 OFF를 비교하는 회귀 테스트를 추가했다. 의상의 얇은 장식선 발광과 리어윙 홈의 발광을 구분해서 확인한다.

```powershell
cd CLOSERS_Explorer
python -m unittest discover -s tests -p 'test_model*.py'
python -m unittest discover -s tests -p 'test_avatar*.py'
python -m unittest discover -s tests -p 'test_material*.py'
cd ..
python CLOSERS_Explorer/tests/audit_avatar_materials.py --workspace results --output diagnostics/material-audit.json
```

브라우저 검증은 WebGL에서 발광의 수치식·채널별 색·기본색 독립성, 원본 알파 보존, 무관한 재질·아이템의 불변, 토글 복원, 일반 스키닝과 5개 이상 가중치 스키닝, 누락 텍스처의 기본색 유지를 검사한다. Python 검증은 A/B/C 공유 메시 격리, 원본 텍스처 매칭, 중복 정의와 수치 유효성, 기존 눈동자·장비 숨김·애니메이션을 포함한다.

실제 모델 자료는 다음과 같다. 픽셀 수치는 RGB **채널** 변경 수이며 화질 일치 점수가 아니다.

- 발광 액세서리 297149 / `ROGUE:449991012:0`: 주황색 홈 부분에 영향. 변경 6,069채널, 최대 64/255, 알파 변화 0. `diagnostics/emissive-preview-{on,off}.png`, `emissive-browser.json`.
- 하피 이슬라 리트모에 RARE_7 상의(311505 / `ROGUE:340734004:0`)를 입힌 12개 파일·24개 메시·18,395정점: 변경 497채널, 최대 19/255, 알파 변화 0. 변화는 화면 위쪽 어깨 부근(x 208~549, y 169~178)에 국한된다. `diagnostics/cloth-material-preview-{on,off}.png`, `cloth-material-browser.json`. 다리 피부·신발에 같은 효과를 적용하지 않는다.
- 같은 전신에서 공용 뼈 171835의 실제 ASTAND 동작 92키·149뼈를 불러와 재생 시간이 진행되는 것을 확인했다. 발광 OFF 상태도 유지된다. `diagnostics/cloth-material-animation.png`. 위 자동 테스트 66개가 통과했다.
- 날개와 전신을 합친 보조 진단도 남겼지만 날개 부착 위치가 떠 있는 기본 자세가 관찰되어 부착 재현의 검증 자료로 사용하지 않는다. 상의로 교체한 전신 검증을 사용한다.

25,565개 XET 정의에서 기존 형식의 미해석 항목은 0이다. 새로 보존한 보조 블록의 충돌 28개는 효과만 보류한다. 기존 14개 충돌 중 한 개는 기본색 변경표가 같고 shader_changes 플래그만 달라 차단할 이유가 없어졌으며, 기본색/기존 입력 충돌은 13개다. 이 수치는 툰·발광의 모든 런타임 의미를 해석했다는 뜻이 아니다.
