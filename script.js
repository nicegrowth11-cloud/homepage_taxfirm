const menu=document.querySelector('.menu');
const nav=document.querySelector('#nav');
function closeMenu(){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','메뉴 열기');menu.textContent='☰';}
menu.addEventListener('click',()=>{const opened=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(opened));menu.setAttribute('aria-label',opened?'메뉴 닫기':'메뉴 열기');menu.textContent=opened?'✕':'☰';nav.classList.toggle('open',opened);});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
const dialog=document.querySelector('#consult-dialog');
const field=document.querySelector('#consult-field');
const note=document.querySelector('#consult-note');
const status=document.querySelector('#consult-status');
const tips={'병의원 세무':'진료과, 개원 예정일 또는 운영 기간, 직원 수, 기장·신고 등 궁금한 업무를 정리해 주세요. 환자 정보는 필요하지 않습니다.','부동산 세무':'부동산 종류, 취득 시기, 소유 현황, 예정 거래와 시기를 정리해 주세요. 주민등록번호나 계좌번호는 입력하지 마세요.','창업 세무':'예정 업종, 사업장 소재지, 시작 시기, 공동사업 여부와 개인·법인 선택에 대한 고민을 정리해 주세요.','기타 세무 상담':'상담 주제, 현재 진행 상황, 궁금한 점과 예정 일정을 간단히 정리해 주세요.'};
function updatePreparation(){document.querySelector('#consult-preparation').textContent=tips[field.value];status.textContent='';}
let returnFocus=null;
document.querySelectorAll('[data-consult]').forEach(button=>button.addEventListener('click',()=>{returnFocus=button;closeMenu();field.value=button.dataset.consult||'병의원 세무';updatePreparation();dialog.showModal();field.focus();}));
field.addEventListener('change',updatePreparation);
document.querySelector('#close-consult').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{note.value='';status.textContent='';if(returnFocus)returnFocus.focus();});
document.querySelector('#copy-note').addEventListener('click',async()=>{try{await navigator.clipboard.writeText('상담 분야: '+field.value+'\n'+note.value);status.textContent='상담 메모를 복사했습니다. 온라인으로 접수된 것은 아닙니다.';}catch{status.textContent='복사할 수 없습니다. 작성한 메모를 직접 선택해 복사해 주세요.';}});
