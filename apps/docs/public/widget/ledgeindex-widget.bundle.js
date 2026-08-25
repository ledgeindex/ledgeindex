var LedgeIndexWidget=(function(k){"use strict";var fs=Object.defineProperty;var $n=k=>{throw TypeError(k)};var bs=(k,w,v)=>w in k?fs(k,w,{enumerable:!0,configurable:!0,writable:!0,value:v}):k[w]=v;var y=(k,w,v)=>bs(k,typeof w!="symbol"?w+"":w,v),Ne=(k,w,v)=>w.has(k)||$n("Cannot "+v);var R=(k,w,v)=>(Ne(k,w,"read from private field"),v?v.call(k):w.get(k)),F=(k,w,v)=>w.has(k)?$n("Cannot add the same private member more than once"):w instanceof WeakSet?w.add(k):w.set(k,v),z=(k,w,v,H)=>(Ne(k,w,"write to private field"),H?H.call(k,v):w.set(k,v),v),E=(k,w,v)=>(Ne(k,w,"access private method"),v);var Ae,I,U,D,j,g,Oe,Pe,_,De,On,se,ae,ie,Pn;function w(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var v=w();function H(n){v=n}var G={exec:()=>null};function b(n,e=""){let t=typeof n=="string"?n:n.source;const r={replace:(s,a)=>{let i=typeof a=="string"?a:a.source;return i=i.replace(S.caret,"$1"),t=t.replace(s,i),r},getRegex:()=>new RegExp(t,e)};return r}var S={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] /,listReplaceTask:/^\[[ xX]\] +/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:n=>new RegExp(`^( {0,3}${n})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}#`),htmlBeginRegex:n=>new RegExp(`^ {0,${Math.min(3,n-1)}}<(?:[a-z].*>|!--)`,"i")},Dn=/^(?:[ \t]*(?:\n|$))+/,jn=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,zn=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,q=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,_n=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,le=/(?:[*+-]|\d{1,9}[.)])/,je=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,ze=b(je).replace(/bull/g,le).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),Bn=b(je).replace(/bull/g,le).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),oe=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,Mn=/^[^\n]+/,ce=/(?!\s*\])(?:\\.|[^\[\]\\])+/,Un=b(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",ce).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),Fn=b(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,le).getRegex(),Q="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",pe=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,Hn=b("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",pe).replace("tag",Q).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),_e=b(oe).replace("hr",q).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Q).getRegex(),Gn=b(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",_e).getRegex(),he={blockquote:Gn,code:jn,def:Un,fences:zn,heading:_n,hr:q,html:Hn,lheading:ze,list:Fn,newline:Dn,paragraph:_e,table:G,text:Mn},Be=b("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",q).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Q).getRegex(),qn={...he,lheading:Bn,table:Be,paragraph:b(oe).replace("hr",q).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Be).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",Q).getRegex()},Zn={...he,html:b(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",pe).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:G,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:b(oe).replace("hr",q).replace("heading",` *#{1,6} *[^
]`).replace("lheading",ze).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Wn=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,Yn=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Me=/^( {2,}|\\)\n(?!\s*$)/,Xn=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,K=/[\p{P}\p{S}]/u,ue=/[\s\p{P}\p{S}]/u,Ue=/[^\s\p{P}\p{S}]/u,Qn=b(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,ue).getRegex(),Fe=/(?!~)[\p{P}\p{S}]/u,Kn=/(?!~)[\s\p{P}\p{S}]/u,Vn=/(?:[^\s\p{P}\p{S}]|~)/u,Jn=/\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g,He=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,er=b(He,"u").replace(/punct/g,K).getRegex(),tr=b(He,"u").replace(/punct/g,Fe).getRegex(),Ge="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",nr=b(Ge,"gu").replace(/notPunctSpace/g,Ue).replace(/punctSpace/g,ue).replace(/punct/g,K).getRegex(),rr=b(Ge,"gu").replace(/notPunctSpace/g,Vn).replace(/punctSpace/g,Kn).replace(/punct/g,Fe).getRegex(),sr=b("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Ue).replace(/punctSpace/g,ue).replace(/punct/g,K).getRegex(),ar=b(/\\(punct)/,"gu").replace(/punct/g,K).getRegex(),ir=b(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),lr=b(pe).replace("(?:-->|$)","-->").getRegex(),or=b("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",lr).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),V=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/,cr=b(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",V).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),qe=b(/^!?\[(label)\]\[(ref)\]/).replace("label",V).replace("ref",ce).getRegex(),Ze=b(/^!?\[(ref)\](?:\[\])?/).replace("ref",ce).getRegex(),pr=b("reflink|nolink(?!\\()","g").replace("reflink",qe).replace("nolink",Ze).getRegex(),de={_backpedal:G,anyPunctuation:ar,autolink:ir,blockSkip:Jn,br:Me,code:Yn,del:G,emStrongLDelim:er,emStrongRDelimAst:nr,emStrongRDelimUnd:sr,escape:Wn,link:cr,nolink:Ze,punctuation:Qn,reflink:qe,reflinkSearch:pr,tag:or,text:Xn,url:G},hr={...de,link:b(/^!?\[(label)\]\((.*?)\)/).replace("label",V).getRegex(),reflink:b(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",V).getRegex()},ge={...de,emStrongRDelimAst:rr,emStrongLDelim:tr,url:b(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,"i").replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/},ur={...ge,br:b(Me).replace("{2,}","*").getRegex(),text:b(ge.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},J={normal:he,gfm:qn,pedantic:Zn},Z={normal:de,gfm:ge,breaks:ur,pedantic:hr},dr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},We=n=>dr[n];function N(n,e){if(e){if(S.escapeTest.test(n))return n.replace(S.escapeReplace,We)}else if(S.escapeTestNoEncode.test(n))return n.replace(S.escapeReplaceNoEncode,We);return n}function Ye(n){try{n=encodeURI(n).replace(S.percentDecode,"%")}catch{return null}return n}function Xe(n,e){const t=n.replace(S.findPipe,(a,i,l)=>{let c=!1,o=i;for(;--o>=0&&l[o]==="\\";)c=!c;return c?"|":" |"}),r=t.split(S.splitPipe);let s=0;if(r[0].trim()||r.shift(),r.length>0&&!r.at(-1)?.trim()&&r.pop(),e)if(r.length>e)r.splice(e);else for(;r.length<e;)r.push("");for(;s<r.length;s++)r[s]=r[s].trim().replace(S.slashPipe,"|");return r}function W(n,e,t){const r=n.length;if(r===0)return"";let s=0;for(;s<r&&n.charAt(r-s-1)===e;)s++;return n.slice(0,r-s)}function gr(n,e){if(n.indexOf(e[1])===-1)return-1;let t=0;for(let r=0;r<n.length;r++)if(n[r]==="\\")r++;else if(n[r]===e[0])t++;else if(n[r]===e[1]&&(t--,t<0))return r;return t>0?-2:-1}function Qe(n,e,t,r,s){const a=e.href,i=e.title||null,l=n[1].replace(s.other.outputLinkReplace,"$1");r.state.inLink=!0;const c={type:n[0].charAt(0)==="!"?"image":"link",raw:t,href:a,title:i,text:l,tokens:r.inlineTokens(l)};return r.state.inLink=!1,c}function mr(n,e,t){const r=n.match(t.other.indentCodeCompensation);if(r===null)return e;const s=r[1];return e.split(`
`).map(a=>{const i=a.match(t.other.beginningSpace);if(i===null)return a;const[l]=i;return l.length>=s.length?a.slice(s.length):a}).join(`
`)}var ee=class{constructor(n){y(this,"options");y(this,"rules");y(this,"lexer");this.options=n||v}space(n){const e=this.rules.block.newline.exec(n);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(n){const e=this.rules.block.code.exec(n);if(e){const t=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?t:W(t,`
`)}}}fences(n){const e=this.rules.block.fences.exec(n);if(e){const t=e[0],r=mr(t,e[3]||"",this.rules);return{type:"code",raw:t,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:r}}}heading(n){const e=this.rules.block.heading.exec(n);if(e){let t=e[2].trim();if(this.rules.other.endingHash.test(t)){const r=W(t,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(t=r.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:t,tokens:this.lexer.inline(t)}}}hr(n){const e=this.rules.block.hr.exec(n);if(e)return{type:"hr",raw:W(e[0],`
`)}}blockquote(n){const e=this.rules.block.blockquote.exec(n);if(e){let t=W(e[0],`
`).split(`
`),r="",s="";const a=[];for(;t.length>0;){let i=!1;const l=[];let c;for(c=0;c<t.length;c++)if(this.rules.other.blockquoteStart.test(t[c]))l.push(t[c]),i=!0;else if(!i)l.push(t[c]);else break;t=t.slice(c);const o=l.join(`
`),h=o.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?`${r}
${o}`:o,s=s?`${s}
${h}`:h;const x=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(h,a,!0),this.lexer.state.top=x,t.length===0)break;const p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){const T=p,m=T.raw+`
`+t.join(`
`),L=this.blockquote(m);a[a.length-1]=L,r=r.substring(0,r.length-T.raw.length)+L.raw,s=s.substring(0,s.length-T.text.length)+L.text;break}else if(p?.type==="list"){const T=p,m=T.raw+`
`+t.join(`
`),L=this.list(m);a[a.length-1]=L,r=r.substring(0,r.length-p.raw.length)+L.raw,s=s.substring(0,s.length-T.raw.length)+L.raw,t=m.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:r,tokens:a,text:s}}}list(n){let e=this.rules.block.list.exec(n);if(e){let t=e[1].trim();const r=t.length>1,s={type:"list",raw:"",ordered:r,start:r?+t.slice(0,-1):"",loose:!1,items:[]};t=r?`\\d{1,9}\\${t.slice(-1)}`:`\\${t}`,this.options.pedantic&&(t=r?t:"[*+-]");const a=this.rules.other.listItemRegex(t);let i=!1;for(;n;){let c=!1,o="",h="";if(!(e=a.exec(n))||this.rules.block.hr.test(n))break;o=e[0],n=n.substring(o.length);let x=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,Ie=>" ".repeat(3*Ie.length)),p=n.split(`
`,1)[0],T=!x.trim(),m=0;if(this.options.pedantic?(m=2,h=x.trimStart()):T?m=e[1].length+1:(m=e[2].search(this.rules.other.nonSpaceChar),m=m>4?1:m,h=x.slice(m),m+=e[1].length),T&&this.rules.other.blankLine.test(p)&&(o+=p+`
`,n=n.substring(p.length+1),c=!0),!c){const Ie=this.rules.other.nextBulletRegex(m),Ln=this.rules.other.hrRegex(m),Nn=this.rules.other.fencesBeginRegex(m),Cn=this.rules.other.headingBeginRegex(m),ms=this.rules.other.htmlBeginRegex(m);for(;n;){const Le=n.split(`
`,1)[0];let X;if(p=Le,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),X=p):X=p.replace(this.rules.other.tabCharGlobal,"    "),Nn.test(p)||Cn.test(p)||ms.test(p)||Ie.test(p)||Ln.test(p))break;if(X.search(this.rules.other.nonSpaceChar)>=m||!p.trim())h+=`
`+X.slice(m);else{if(T||x.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||Nn.test(x)||Cn.test(x)||Ln.test(x))break;h+=`
`+p}!T&&!p.trim()&&(T=!0),o+=Le+`
`,n=n.substring(Le.length+1),x=X.slice(m)}}s.loose||(i?s.loose=!0:this.rules.other.doubleBlankLine.test(o)&&(i=!0));let L=null,In;this.options.gfm&&(L=this.rules.other.listIsTask.exec(h),L&&(In=L[0]!=="[ ] ",h=h.replace(this.rules.other.listReplaceTask,""))),s.items.push({type:"list_item",raw:o,task:!!L,checked:In,loose:!1,text:h,tokens:[]}),s.raw+=o}const l=s.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;s.raw=s.raw.trimEnd();for(let c=0;c<s.items.length;c++)if(this.lexer.state.top=!1,s.items[c].tokens=this.lexer.blockTokens(s.items[c].text,[]),!s.loose){const o=s.items[c].tokens.filter(x=>x.type==="space"),h=o.length>0&&o.some(x=>this.rules.other.anyLine.test(x.raw));s.loose=h}if(s.loose)for(let c=0;c<s.items.length;c++)s.items[c].loose=!0;return s}}html(n){const e=this.rules.block.html.exec(n);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(n){const e=this.rules.block.def.exec(n);if(e){const t=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",s=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:t,raw:e[0],href:r,title:s}}}table(n){const e=this.rules.block.table.exec(n);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;const t=Xe(e[1]),r=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),s=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(t.length===r.length){for(const i of r)this.rules.other.tableAlignRight.test(i)?a.align.push("right"):this.rules.other.tableAlignCenter.test(i)?a.align.push("center"):this.rules.other.tableAlignLeft.test(i)?a.align.push("left"):a.align.push(null);for(let i=0;i<t.length;i++)a.header.push({text:t[i],tokens:this.lexer.inline(t[i]),header:!0,align:a.align[i]});for(const i of s)a.rows.push(Xe(i,a.header.length).map((l,c)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:a.align[c]})));return a}}lheading(n){const e=this.rules.block.lheading.exec(n);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(n){const e=this.rules.block.paragraph.exec(n);if(e){const t=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:t,tokens:this.lexer.inline(t)}}}text(n){const e=this.rules.block.text.exec(n);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(n){const e=this.rules.inline.escape.exec(n);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(n){const e=this.rules.inline.tag.exec(n);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(n){const e=this.rules.inline.link.exec(n);if(e){const t=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(t)){if(!this.rules.other.endAngleBracket.test(t))return;const a=W(t.slice(0,-1),"\\");if((t.length-a.length)%2===0)return}else{const a=gr(e[2],"()");if(a===-2)return;if(a>-1){const l=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,l).trim(),e[3]=""}}let r=e[2],s="";if(this.options.pedantic){const a=this.rules.other.pedanticHrefTitle.exec(r);a&&(r=a[1],s=a[3])}else s=e[3]?e[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(t)?r=r.slice(1):r=r.slice(1,-1)),Qe(e,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:s&&s.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(n,e){let t;if((t=this.rules.inline.reflink.exec(n))||(t=this.rules.inline.nolink.exec(n))){const r=(t[2]||t[1]).replace(this.rules.other.multipleSpaceGlobal," "),s=e[r.toLowerCase()];if(!s){const a=t[0].charAt(0);return{type:"text",raw:a,text:a}}return Qe(t,s,t[0],this.lexer,this.rules)}}emStrong(n,e,t=""){let r=this.rules.inline.emStrongLDelim.exec(n);if(!r||r[3]&&t.match(this.rules.other.unicodeAlphaNumeric))return;if(!(r[1]||r[2]||"")||!t||this.rules.inline.punctuation.exec(t)){const a=[...r[0]].length-1;let i,l,c=a,o=0;const h=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(h.lastIndex=0,e=e.slice(-1*n.length+a);(r=h.exec(e))!=null;){if(i=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!i)continue;if(l=[...i].length,r[3]||r[4]){c+=l;continue}else if((r[5]||r[6])&&a%3&&!((a+l)%3)){o+=l;continue}if(c-=l,c>0)continue;l=Math.min(l,l+c+o);const x=[...r[0]][0].length,p=n.slice(0,a+r.index+x+l);if(Math.min(a,l)%2){const m=p.slice(1,-1);return{type:"em",raw:p,text:m,tokens:this.lexer.inlineTokens(m)}}const T=p.slice(2,-2);return{type:"strong",raw:p,text:T,tokens:this.lexer.inlineTokens(T)}}}}codespan(n){const e=this.rules.inline.code.exec(n);if(e){let t=e[2].replace(this.rules.other.newLineCharGlobal," ");const r=this.rules.other.nonSpaceChar.test(t),s=this.rules.other.startingSpaceChar.test(t)&&this.rules.other.endingSpaceChar.test(t);return r&&s&&(t=t.substring(1,t.length-1)),{type:"codespan",raw:e[0],text:t}}}br(n){const e=this.rules.inline.br.exec(n);if(e)return{type:"br",raw:e[0]}}del(n){const e=this.rules.inline.del.exec(n);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(n){const e=this.rules.inline.autolink.exec(n);if(e){let t,r;return e[2]==="@"?(t=e[1],r="mailto:"+t):(t=e[1],r=t),{type:"link",raw:e[0],text:t,href:r,tokens:[{type:"text",raw:t,text:t}]}}}url(n){let e;if(e=this.rules.inline.url.exec(n)){let t,r;if(e[2]==="@")t=e[0],r="mailto:"+t;else{let s;do s=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(s!==e[0]);t=e[0],e[1]==="www."?r="http://"+e[0]:r=e[0]}return{type:"link",raw:e[0],text:t,href:r,tokens:[{type:"text",raw:t,text:t}]}}}inlineText(n){const e=this.rules.inline.text.exec(n);if(e){const t=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:t}}}},C=class Ce{constructor(e){y(this,"tokens");y(this,"options");y(this,"state");y(this,"tokenizer");y(this,"inlineQueue");this.tokens=[],this.tokens.links=Object.create(null),this.options=e||v,this.options.tokenizer=this.options.tokenizer||new ee,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const t={other:S,block:J.normal,inline:Z.normal};this.options.pedantic?(t.block=J.pedantic,t.inline=Z.pedantic):this.options.gfm&&(t.block=J.gfm,this.options.breaks?t.inline=Z.breaks:t.inline=Z.gfm),this.tokenizer.rules=t}static get rules(){return{block:J,inline:Z}}static lex(e,t){return new Ce(t).lex(e)}static lexInline(e,t){return new Ce(t).inlineTokens(e)}lex(e){e=e.replace(S.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){const r=this.inlineQueue[t];this.inlineTokens(r.src,r.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],r=!1){for(this.options.pedantic&&(e=e.replace(S.tabCharGlobal,"    ").replace(S.spaceLine,""));e;){let s;if(this.options.extensions?.block?.some(i=>(s=i.call({lexer:this},e,t))?(e=e.substring(s.raw.length),t.push(s),!0):!1))continue;if(s=this.tokenizer.space(e)){e=e.substring(s.raw.length);const i=t.at(-1);s.raw.length===1&&i!==void 0?i.raw+=`
`:t.push(s);continue}if(s=this.tokenizer.code(e)){e=e.substring(s.raw.length);const i=t.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=`
`+s.raw,i.text+=`
`+s.text,this.inlineQueue.at(-1).src=i.text):t.push(s);continue}if(s=this.tokenizer.fences(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.heading(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.hr(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.blockquote(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.list(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.html(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.def(e)){e=e.substring(s.raw.length);const i=t.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=`
`+s.raw,i.text+=`
`+s.raw,this.inlineQueue.at(-1).src=i.text):this.tokens.links[s.tag]||(this.tokens.links[s.tag]={href:s.href,title:s.title});continue}if(s=this.tokenizer.table(e)){e=e.substring(s.raw.length),t.push(s);continue}if(s=this.tokenizer.lheading(e)){e=e.substring(s.raw.length),t.push(s);continue}let a=e;if(this.options.extensions?.startBlock){let i=1/0;const l=e.slice(1);let c;this.options.extensions.startBlock.forEach(o=>{c=o.call({lexer:this},l),typeof c=="number"&&c>=0&&(i=Math.min(i,c))}),i<1/0&&i>=0&&(a=e.substring(0,i+1))}if(this.state.top&&(s=this.tokenizer.paragraph(a))){const i=t.at(-1);r&&i?.type==="paragraph"?(i.raw+=`
`+s.raw,i.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):t.push(s),r=a.length!==e.length,e=e.substring(s.raw.length);continue}if(s=this.tokenizer.text(e)){e=e.substring(s.raw.length);const i=t.at(-1);i?.type==="text"?(i.raw+=`
`+s.raw,i.text+=`
`+s.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):t.push(s);continue}if(e){const i="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(i);break}else throw new Error(i)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let r=e,s=null;if(this.tokens.links){const l=Object.keys(this.tokens.links);if(l.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(r))!=null;)l.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(r=r.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(r))!=null;)r=r.slice(0,s.index)+"++"+r.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;(s=this.tokenizer.rules.inline.blockSkip.exec(r))!=null;)r=r.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);let a=!1,i="";for(;e;){a||(i=""),a=!1;let l;if(this.options.extensions?.inline?.some(o=>(l=o.call({lexer:this},e,t))?(e=e.substring(l.raw.length),t.push(l),!0):!1))continue;if(l=this.tokenizer.escape(e)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.tag(e)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.link(e)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(l.raw.length);const o=t.at(-1);l.type==="text"&&o?.type==="text"?(o.raw+=l.raw,o.text+=l.text):t.push(l);continue}if(l=this.tokenizer.emStrong(e,r,i)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.codespan(e)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.br(e)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.del(e)){e=e.substring(l.raw.length),t.push(l);continue}if(l=this.tokenizer.autolink(e)){e=e.substring(l.raw.length),t.push(l);continue}if(!this.state.inLink&&(l=this.tokenizer.url(e))){e=e.substring(l.raw.length),t.push(l);continue}let c=e;if(this.options.extensions?.startInline){let o=1/0;const h=e.slice(1);let x;this.options.extensions.startInline.forEach(p=>{x=p.call({lexer:this},h),typeof x=="number"&&x>=0&&(o=Math.min(o,x))}),o<1/0&&o>=0&&(c=e.substring(0,o+1))}if(l=this.tokenizer.inlineText(c)){e=e.substring(l.raw.length),l.raw.slice(-1)!=="_"&&(i=l.raw.slice(-1)),a=!0;const o=t.at(-1);o?.type==="text"?(o.raw+=l.raw,o.text+=l.text):t.push(l);continue}if(e){const o="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(o);break}else throw new Error(o)}}return t}},te=class{constructor(n){y(this,"options");y(this,"parser");this.options=n||v}space(n){return""}code({text:n,lang:e,escaped:t}){const r=(e||"").match(S.notSpaceStart)?.[0],s=n.replace(S.endingNewline,"")+`
`;return r?'<pre><code class="language-'+N(r)+'">'+(t?s:N(s,!0))+`</code></pre>
`:"<pre><code>"+(t?s:N(s,!0))+`</code></pre>
`}blockquote({tokens:n}){return`<blockquote>
${this.parser.parse(n)}</blockquote>
`}html({text:n}){return n}heading({tokens:n,depth:e}){return`<h${e}>${this.parser.parseInline(n)}</h${e}>
`}hr(n){return`<hr>
`}list(n){const e=n.ordered,t=n.start;let r="";for(let i=0;i<n.items.length;i++){const l=n.items[i];r+=this.listitem(l)}const s=e?"ol":"ul",a=e&&t!==1?' start="'+t+'"':"";return"<"+s+a+`>
`+r+"</"+s+`>
`}listitem(n){let e="";if(n.task){const t=this.checkbox({checked:!!n.checked});n.loose?n.tokens[0]?.type==="paragraph"?(n.tokens[0].text=t+" "+n.tokens[0].text,n.tokens[0].tokens&&n.tokens[0].tokens.length>0&&n.tokens[0].tokens[0].type==="text"&&(n.tokens[0].tokens[0].text=t+" "+N(n.tokens[0].tokens[0].text),n.tokens[0].tokens[0].escaped=!0)):n.tokens.unshift({type:"text",raw:t+" ",text:t+" ",escaped:!0}):e+=t+" "}return e+=this.parser.parse(n.tokens,!!n.loose),`<li>${e}</li>
`}checkbox({checked:n}){return"<input "+(n?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph({tokens:n}){return`<p>${this.parser.parseInline(n)}</p>
`}table(n){let e="",t="";for(let s=0;s<n.header.length;s++)t+=this.tablecell(n.header[s]);e+=this.tablerow({text:t});let r="";for(let s=0;s<n.rows.length;s++){const a=n.rows[s];t="";for(let i=0;i<a.length;i++)t+=this.tablecell(a[i]);r+=this.tablerow({text:t})}return r&&(r=`<tbody>${r}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+r+`</table>
`}tablerow({text:n}){return`<tr>
${n}</tr>
`}tablecell(n){const e=this.parser.parseInline(n.tokens),t=n.header?"th":"td";return(n.align?`<${t} align="${n.align}">`:`<${t}>`)+e+`</${t}>
`}strong({tokens:n}){return`<strong>${this.parser.parseInline(n)}</strong>`}em({tokens:n}){return`<em>${this.parser.parseInline(n)}</em>`}codespan({text:n}){return`<code>${N(n,!0)}</code>`}br(n){return"<br>"}del({tokens:n}){return`<del>${this.parser.parseInline(n)}</del>`}link({href:n,title:e,tokens:t}){const r=this.parser.parseInline(t),s=Ye(n);if(s===null)return r;n=s;let a='<a href="'+n+'"';return e&&(a+=' title="'+N(e)+'"'),a+=">"+r+"</a>",a}image({href:n,title:e,text:t,tokens:r}){r&&(t=this.parser.parseInline(r,this.parser.textRenderer));const s=Ye(n);if(s===null)return N(t);n=s;let a=`<img src="${n}" alt="${t}"`;return e&&(a+=` title="${N(e)}"`),a+=">",a}text(n){return"tokens"in n&&n.tokens?this.parser.parseInline(n.tokens):"escaped"in n&&n.escaped?n.text:N(n.text)}},me=class{strong({text:n}){return n}em({text:n}){return n}codespan({text:n}){return n}del({text:n}){return n}html({text:n}){return n}text({text:n}){return n}link({text:n}){return""+n}image({text:n}){return""+n}br(){return""}},$=class $e{constructor(e){y(this,"options");y(this,"renderer");y(this,"textRenderer");this.options=e||v,this.options.renderer=this.options.renderer||new te,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new me}static parse(e,t){return new $e(t).parse(e)}static parseInline(e,t){return new $e(t).parseInline(e)}parse(e,t=!0){let r="";for(let s=0;s<e.length;s++){const a=e[s];if(this.options.extensions?.renderers?.[a.type]){const l=a,c=this.options.extensions.renderers[l.type].call({parser:this},l);if(c!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(l.type)){r+=c||"";continue}}const i=a;switch(i.type){case"space":{r+=this.renderer.space(i);continue}case"hr":{r+=this.renderer.hr(i);continue}case"heading":{r+=this.renderer.heading(i);continue}case"code":{r+=this.renderer.code(i);continue}case"table":{r+=this.renderer.table(i);continue}case"blockquote":{r+=this.renderer.blockquote(i);continue}case"list":{r+=this.renderer.list(i);continue}case"html":{r+=this.renderer.html(i);continue}case"paragraph":{r+=this.renderer.paragraph(i);continue}case"text":{let l=i,c=this.renderer.text(l);for(;s+1<e.length&&e[s+1].type==="text";)l=e[++s],c+=`
`+this.renderer.text(l);t?r+=this.renderer.paragraph({type:"paragraph",raw:c,text:c,tokens:[{type:"text",raw:c,text:c,escaped:!0}]}):r+=c;continue}default:{const l='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return r}parseInline(e,t=this.renderer){let r="";for(let s=0;s<e.length;s++){const a=e[s];if(this.options.extensions?.renderers?.[a.type]){const l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){r+=l||"";continue}}const i=a;switch(i.type){case"escape":{r+=t.text(i);break}case"html":{r+=t.html(i);break}case"link":{r+=t.link(i);break}case"image":{r+=t.image(i);break}case"strong":{r+=t.strong(i);break}case"em":{r+=t.em(i);break}case"codespan":{r+=t.codespan(i);break}case"br":{r+=t.br(i);break}case"del":{r+=t.del(i);break}case"text":{r+=t.text(i);break}default:{const l='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return r}},ne=(Ae=class{constructor(n){y(this,"options");y(this,"block");this.options=n||v}preprocess(n){return n}postprocess(n){return n}processAllTokens(n){return n}provideLexer(){return this.block?C.lex:C.lexInline}provideParser(){return this.block?$.parse:$.parseInline}},y(Ae,"passThroughHooks",new Set(["preprocess","postprocess","processAllTokens"])),Ae),fr=class{constructor(...n){y(this,"defaults",w());y(this,"options",this.setOptions);y(this,"parse",this.parseMarkdown(!0));y(this,"parseInline",this.parseMarkdown(!1));y(this,"Parser",$);y(this,"Renderer",te);y(this,"TextRenderer",me);y(this,"Lexer",C);y(this,"Tokenizer",ee);y(this,"Hooks",ne);this.use(...n)}walkTokens(n,e){let t=[];for(const r of n)switch(t=t.concat(e.call(this,r)),r.type){case"table":{const s=r;for(const a of s.header)t=t.concat(this.walkTokens(a.tokens,e));for(const a of s.rows)for(const i of a)t=t.concat(this.walkTokens(i.tokens,e));break}case"list":{const s=r;t=t.concat(this.walkTokens(s.items,e));break}default:{const s=r;this.defaults.extensions?.childTokens?.[s.type]?this.defaults.extensions.childTokens[s.type].forEach(a=>{const i=s[a].flat(1/0);t=t.concat(this.walkTokens(i,e))}):s.tokens&&(t=t.concat(this.walkTokens(s.tokens,e)))}}return t}use(...n){const e=this.defaults.extensions||{renderers:{},childTokens:{}};return n.forEach(t=>{const r={...t};if(r.async=this.defaults.async||r.async||!1,t.extensions&&(t.extensions.forEach(s=>{if(!s.name)throw new Error("extension name required");if("renderer"in s){const a=e.renderers[s.name];a?e.renderers[s.name]=function(...i){let l=s.renderer.apply(this,i);return l===!1&&(l=a.apply(this,i)),l}:e.renderers[s.name]=s.renderer}if("tokenizer"in s){if(!s.level||s.level!=="block"&&s.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const a=e[s.level];a?a.unshift(s.tokenizer):e[s.level]=[s.tokenizer],s.start&&(s.level==="block"?e.startBlock?e.startBlock.push(s.start):e.startBlock=[s.start]:s.level==="inline"&&(e.startInline?e.startInline.push(s.start):e.startInline=[s.start]))}"childTokens"in s&&s.childTokens&&(e.childTokens[s.name]=s.childTokens)}),r.extensions=e),t.renderer){const s=this.defaults.renderer||new te(this.defaults);for(const a in t.renderer){if(!(a in s))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;const i=a,l=t.renderer[i],c=s[i];s[i]=(...o)=>{let h=l.apply(s,o);return h===!1&&(h=c.apply(s,o)),h||""}}r.renderer=s}if(t.tokenizer){const s=this.defaults.tokenizer||new ee(this.defaults);for(const a in t.tokenizer){if(!(a in s))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;const i=a,l=t.tokenizer[i],c=s[i];s[i]=(...o)=>{let h=l.apply(s,o);return h===!1&&(h=c.apply(s,o)),h}}r.tokenizer=s}if(t.hooks){const s=this.defaults.hooks||new ne;for(const a in t.hooks){if(!(a in s))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;const i=a,l=t.hooks[i],c=s[i];ne.passThroughHooks.has(a)?s[i]=o=>{if(this.defaults.async)return Promise.resolve(l.call(s,o)).then(x=>c.call(s,x));const h=l.call(s,o);return c.call(s,h)}:s[i]=(...o)=>{let h=l.apply(s,o);return h===!1&&(h=c.apply(s,o)),h}}r.hooks=s}if(t.walkTokens){const s=this.defaults.walkTokens,a=t.walkTokens;r.walkTokens=function(i){let l=[];return l.push(a.call(this,i)),s&&(l=l.concat(s.call(this,i))),l}}this.defaults={...this.defaults,...r}}),this}setOptions(n){return this.defaults={...this.defaults,...n},this}lexer(n,e){return C.lex(n,e??this.defaults)}parser(n,e){return $.parse(n,e??this.defaults)}parseMarkdown(n){return(t,r)=>{const s={...r},a={...this.defaults,...s},i=this.onError(!!a.silent,!!a.async);if(this.defaults.async===!0&&s.async===!1)return i(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof t>"u"||t===null)return i(new Error("marked(): input parameter is undefined or null"));if(typeof t!="string")return i(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(t)+", string expected"));a.hooks&&(a.hooks.options=a,a.hooks.block=n);const l=a.hooks?a.hooks.provideLexer():n?C.lex:C.lexInline,c=a.hooks?a.hooks.provideParser():n?$.parse:$.parseInline;if(a.async)return Promise.resolve(a.hooks?a.hooks.preprocess(t):t).then(o=>l(o,a)).then(o=>a.hooks?a.hooks.processAllTokens(o):o).then(o=>a.walkTokens?Promise.all(this.walkTokens(o,a.walkTokens)).then(()=>o):o).then(o=>c(o,a)).then(o=>a.hooks?a.hooks.postprocess(o):o).catch(i);try{a.hooks&&(t=a.hooks.preprocess(t));let o=l(t,a);a.hooks&&(o=a.hooks.processAllTokens(o)),a.walkTokens&&this.walkTokens(o,a.walkTokens);let h=c(o,a);return a.hooks&&(h=a.hooks.postprocess(h)),h}catch(o){return i(o)}}}onError(n,e){return t=>{if(t.message+=`
Please report this to https://github.com/markedjs/marked.`,n){const r="<p>An error occurred:</p><pre>"+N(t.message+"",!0)+"</pre>";return e?Promise.resolve(r):r}if(e)return Promise.reject(t);throw t}}},B=new fr;function f(n,e){return B.parse(n,e)}f.options=f.setOptions=function(n){return B.setOptions(n),f.defaults=B.defaults,H(f.defaults),f},f.getDefaults=w,f.defaults=v,f.use=function(...n){return B.use(...n),f.defaults=B.defaults,H(f.defaults),f},f.walkTokens=function(n,e){return B.walkTokens(n,e)},f.parseInline=B.parseInline,f.Parser=$,f.parser=$.parse,f.Renderer=te,f.TextRenderer=me,f.Lexer=C,f.lexer=C.lex,f.Tokenizer=ee,f.Hooks=ne,f.parse=f,f.options,f.setOptions,f.use,f.walkTokens,f.parseInline,$.parse,C.lex;var br=Object.defineProperty,xr=n=>e=>{var t=n[e];if(t)return t();throw new Error("Module not found in bundle: "+e)},u=(n,e,t)=>()=>{if(t)throw t[0];try{return n&&(e=n(n=0)),e}catch(r){throw t=[r],r}},d=(n,e)=>{for(var t in e)br(n,t,{get:e[t],enumerable:!0})},Ke={};d(Ke,{default:()=>Ve});var Ve,kr=u(()=>{Ve=[{type:"cmnt",match:/(;|#).*/gm},{expand:"str"},{expand:"num"},{type:"num",match:/\$[\da-fA-F]*\b/g},{type:"kwd",match:/^[a-z]+\s+[a-z.]+\b/gm,sub:[{type:"func",match:/^[a-z]+/g}]},{type:"kwd",match:/^[ \t]*[a-z][a-z\d]*\b/gm},{match:/%|\$/g,type:"oper"}]}),Je={};d(Je,{default:()=>be});var fe,be,et=u(()=>{fe={type:"var",match:/\$\w+|\${[^}]*}|\$\([^)]*\)/g},be=[{sub:"todo",match:/#.*/g},{type:"str",match:/(["'])((?!\1)[^\r\n\\]|\\[^])*\1?/g,sub:[fe]},{type:"oper",match:/(?<=\s|^)\.*\/[a-z/_.-]+/gi},{type:"kwd",match:/\s-[a-zA-Z]+|$<|[&|;]+|\b(unset|readonly|shift|export|if|fi|else|elif|while|do|done|for|until|case|esac|break|continue|exit|return|trap|wait|eval|exec|then|declare|enable|local|select|typeset|time|add|remove|install|update|delete)(?=\s|$)/g},{expand:"num"},{type:"func",match:/(?<=(^|\||\&\&|\;)\s*)[a-z_.-]+(?=\s|$)/gmi},{type:"bool",match:/(?<=\s|^)(true|false)(?=\s|$)/g},{type:"oper",match:/[=(){}<>!]+/g},{type:"var",match:/(?<=\s|^)[\w_]+(?=\s*=)/g},fe]}),tt={};d(tt,{default:()=>nt});var nt,yr=u(()=>{nt=[{match:/[^,\[\->+.<\]\s].*/g,sub:"todo"},{type:"func",match:/\.+/g},{type:"kwd",match:/[<>]+/g},{type:"oper",match:/[+-]+/g}]}),rt={};d(rt,{default:()=>st});var st,wr=u(()=>{st=[{match:/\/\/.*\n?|\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{expand:"str"},{expand:"num"},{type:"kwd",match:/#\s*include (<.*>|".*")/g,sub:[{type:"str",match:/(<|").*/g}]},{match:/asm\s*{[^}]*}/g,sub:[{type:"kwd",match:/^asm/g},{match:/[^{}]*(?=}$)/g,sub:"asm"}]},{type:"kwd",match:/\*|&|#[a-z]+\b|\b(asm|auto|double|int|struct|break|else|long|switch|case|enum|register|typedef|char|extern|return|union|const|float|short|unsigned|continue|for|signed|void|default|goto|sizeof|volatile|do|if|static|while)\b/g},{type:"oper",match:/[/*+:?&|%^~=!,<>.^-]+/g},{type:"func",match:/[a-zA-Z_][\w_]*(?=\s*\()/g},{type:"class",match:/\b[A-Z][\w_]*\b/g}]}),at={};d(at,{default:()=>it});var it,vr=u(()=>{it=[{match:/\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{expand:"str"},{type:"kwd",match:/@\w+\b|\b(and|not|only|or)\b|\b(?=([a-z-]+))\2(?=[^{}]*{)/g},{type:"var",match:/\b[\w-]+(?=\s*:)|(::?|\.)[\w-]+(?=[^{}]*{)/g},{type:"func",match:/#[\w-]+(?=[^{}]*{)/g},{type:"num",match:/#[\da-f]{3,8}/g},{type:"num",match:/\d+(\.\d+)?(cm|mm|in|px|pt|pc|em|ex|ch|rem|vm|vh|vmin|vmax|%)?/g,sub:[{type:"var",match:/[a-z]+|%/g}]},{match:/url\([^)]*\)/g,sub:[{type:"func",match:/url(?=\()/g},{type:"str",match:/[^()]+/g}]},{type:"func",match:/\b[a-zA-Z]\w*(?=\s*\()/g},{type:"num",match:/\b[a-z-]+\b/g}]}),lt={};d(lt,{default:()=>ot});var ot,Er=u(()=>{ot=[{expand:"strDouble"},{type:"oper",match:/,/g}]}),ct={};d(ct,{default:()=>xe});var xe,pt=u(()=>{xe=[{type:"deleted",match:/^[-<].*/gm},{type:"insert",match:/^[+>].*/gm},{type:"kwd",match:/!.*/gm},{type:"section",match:/^@@.*@@$|^\d.*|^([*-+])\1\1.*/gm}]}),ht={};d(ht,{default:()=>ut});var ut,Tr=u(()=>{et(),ut=[{type:"kwd",match:/^(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/gmi},...be]}),dt={};d(dt,{default:()=>gt});var gt,Rr=u(()=>{pt(),gt=[{match:/^#.*/gm,sub:"todo"},{expand:"str"},...xe,{type:"func",match:/^(\$ )?git(\s.*)?$/gm},{type:"kwd",match:/^commit \w+$/gm}]}),mt={};d(mt,{default:()=>ft});var ft,Sr=u(()=>{ft=[{match:/\/\/.*\n?|\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{type:"str",match:/`[^`]*`?/g},{expand:"str"},{expand:"num"},{type:"kwd",match:/\*|&|\b(break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/g},{type:"func",match:/[a-zA-Z_][\w_]*(?=\s*\()/g},{type:"class",match:/\b[A-Z][\w_]*\b/g},{type:"oper",match:/[+\-*\/%&|^~=!<>.^-]+/g}]}),bt={};d(bt,{default:()=>ye,name:()=>P,properties:()=>M,xmlElement:()=>O});var ke,xt,P,M,O,ye,kt=u(()=>{ke=":A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�",xt=ke+"\\-\\.0-9·̀-ͯ‿-⁀",P=`[${ke}][${xt}]*`,M=`(\\s+${P}\\s*(=\\s*([^"'>\\s][^>\\s]*|("|')(\\\\[^]|(?!\\4)[^])*\\4?)?)?)*\\s*`,O={match:RegExp(`<[/!?]?${P}${M}[/!?]?>`,"g"),sub:[{type:"var",match:RegExp(`^<[/!?]?${P}`,"g"),sub:[{type:"oper",match:/^<[\/!?]?/g}]},{type:"str",match:/=\s*([^"'>\s][^>\s]*|("|')(\\[^]|(?!\2)[^])*\2?)/g,sub:[{type:"oper",match:/^=/g}]},{type:"oper",match:/[\/!?]?>/g},{type:"class",match:RegExp(P,"g")}]},ye=[{match:/<!--[^]*?-->/g,sub:"todo"},{type:"class",match:/<!\[CDATA\[[\s\S]*?\]\]>/gi},O,{type:"str",match:RegExp(`<\\?${P}([^?]|\\?[^?>])*\\?+>`,"g"),sub:[{type:"var",match:RegExp(`^<\\?${P}`,"g"),sub:[{type:"oper",match:/^<\?/g}]},{type:"oper",match:/\?+>$/g}]},{type:"var",match:/&(#x?)?[\da-z]{1,8};/gi}]}),yt={};d(yt,{default:()=>wt});var wt,Ar=u(()=>{kt(),wt=[{type:"class",match:/<!DOCTYPE("[^"]*"|'[^']*'|[^"'>])*>/gi,sub:[{type:"str",match:/"[^"]*"|'[^']*'/g},{type:"oper",match:/^<!|>$/g},{type:"var",match:/DOCTYPE/gi}]},{match:RegExp(`<style${M}>[^]*?</style\\s*>`,"g"),sub:[{match:RegExp(`^<style${M}>`,"g"),sub:O.sub},{match:RegExp(`${O.match}|[^]*(?=</style\\s*>$)`,"g"),sub:"css"},O]},{match:RegExp(`<script${M}>[^]*?<\/script\\s*>`,"g"),sub:[{match:RegExp(`^<script${M}>`,"g"),sub:O.sub},{match:RegExp(`${O.match}|[^]*(?=<\/script\\s*>$)`,"g"),sub:"js"},O]},...ye]}),vt,Y,we=u(()=>{vt=[["bash",[/#!(\/usr)?\/bin\/bash/g,500],[/\b(if|elif|then|fi|echo)\b|\$/g,10]],["html",[/<\/?[a-z-]+[^\n>]*>/g,10],[/^\s+<!DOCTYPE\s+html/g,500]],["http",[/^(GET|HEAD|POST|PUT|DELETE|PATCH|HTTP)\b/g,500]],["js",[/\b(console|await|async|function|export|import|this|class|for|let|const|map|join|require|document|window)\b/g,10]],["ts",[/\b(console|await|async|function|export|import|this|class|for|let|const|map|join|require|document|window|implements|interface|namespace)\b/g,10]],["py",[/\b(def|print|await|async|class|and|or|lambda|import|from|self|asyncio|pass|True|False|None|__init__)\b/g,10]],["sql",[/\b(SELECT|INSERT|FROM)\b/g,50]],["pl",[/#!(\/usr)?\/bin\/perl/g,500],[/\b(use|print)\b|\$/g,10]],["lua",[/#!(\/usr)?\/bin\/lua/g,500]],["make",[/\b(ifneq|endif|if|elif|then|fi|echo|.PHONY|^[a-z]+ ?:$)\b|\$/gm,10]],["uri",[/https?:|mailto:|tel:|ftp:/g,30]],["css",[/^(@import|@page|@media|(\.|#)[a-z]+)/gm,20]],["diff",[/^[+><-]/gm,10],[/^@@ ?[-+,0-9 ]+ ?@@/gm,25]],["md",[/^(>|\t\*|\t\d+.)/gm,10],[/\[.*\](.*)/g,10]],["docker",[/^(FROM|ENTRYPOINT|RUN)/gm,500]],["xml",[/<\/?[a-z-]+[^\n>]*>/g,10],[/^<\?xml/g,500]],["c",[/#include\b|\bprintf\s+\(/g,100]],["rs",[/^\s+(use|fn|mut|match)\b/gm,100]],["go",[/\b(func|fmt|package)\b/g,100]],["java",[/^import\s+java/gm,500]],["asm",[/^(section|global main|extern|\t(call|mov|ret))/gm,100]],["css",[/^(@import|@page|@media|(\.|#)[a-z]+)/gm,20]],["json",[/\b(true|false|null|\{})\b|\"[^"]+\":/g,10]],["yaml",[/^(\s+)?[a-z][a-z0-9]*:/gmi,10]]],Y=n=>vt.map(([e,...t])=>[e,t.reduce((r,[s,a])=>r+[...n.matchAll(s)].length*a,0)]).filter(([e,t])=>t>20).sort((e,t)=>t[1]-e[1])[0]?.[0]||"plain"}),Et={};d(Et,{default:()=>Tt});var Tt,Ir=u(()=>{we(),Tt=[{type:"kwd",match:/^(GET|HEAD|POST|PUT|DELETE|CONNECT|OPTIONS|TRACE|PATCH|PRI|SEARCH)\b/gm},{expand:"str"},{type:"section",match:/\bHTTP\/[\d.]+\b/g},{expand:"num"},{type:"oper",match:/[,;:=]/g},{type:"var",match:/[a-zA-Z][\w-]*(?=:)/g},{match:/\n\n[^]*/g,sub:Y}]}),Rt={};d(Rt,{default:()=>St});var St,Lr=u(()=>{St=[{match:/(^[ \f\t\v]*)[#;].*/gm,sub:"todo"},{type:"var",match:/.*(?==)/g},{type:"section",match:/^\s*\[.+\]\s*$/gm},{type:"oper",match:/=/g},{type:"str",match:/.*/g}]}),At={};d(At,{default:()=>It});var It,Nr=u(()=>{It=[{match:/\/\/.*\n?|\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{type:"str",match:/"""(\\[^]|(?!""")[^])*(""")?/g},{expand:"str"},{expand:"num"},{type:"kwd",match:/\b(abstract|assert|boolean|break|byte|case|catch|char|class|continue|const|default|do|double|else|enum|exports|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|module|native|new|package|private|protected|public|requires|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while)\b/g},{type:"oper",match:/[/*+:?&|%^~=!,<>.^-]+/g},{type:"func",match:/[a-zA-Z_][\w_]*(?=\s*\()/g},{type:"class",match:/\b[A-Z][\w_]*\b/g}]}),Lt={};d(Lt,{default:()=>ve});var ve,Nt=u(()=>{ve=[{match:/(("|')((?!\2)[^\r\n\\]|\\[^])*\2|[a-zA-Z]\w*)(?=\s*:)/g},{match:/\/\*\*((?!\*\/)[^])*(\*\/)?/g,sub:"jsdoc"},{match:/\/\/.*\n?|\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{expand:"str"},{match:/`((?!`)[^]|\\[^])*`?/g,sub:"js_template_literals"},{type:"kwd",match:/=>|\b(this|set|get|as|async|await|break|case|catch|class|const|constructor|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|var|of|new|package|private|protected|public|return|static|super|switch|throw|throws|try|typeof|void|while|with|yield)\b/g},{match:/\/((?!\/)[^\r\n\\]|\\.)+\/[dgimsuy]*/g,sub:"regex"},{expand:"num"},{type:"num",match:/\b(NaN|null|undefined|[A-Z][A-Z_]*)\b/g},{type:"bool",match:/\b(true|false)\b/g},{type:"oper",match:/[/*+:?&|%^~=!,<>.^-]+/g},{type:"class",match:/\b[A-Z][\w_]*\b/g},{type:"func",match:/[a-zA-Z$_][\w$_]*(?=\s*((\?\.)?\s*\(|=\s*(\(?[\w,{}\[\])]+\)? =>|function\b)))/g}]}),Ct={};d(Ct,{default:()=>$t,type:()=>Ot});var $t,Ot,Cr=u(()=>{$t=[{match:new class{exec(n){let e=this.lastIndex,t,r=s=>{for(;++e<n.length-2;)if(n[e]=="{")r();else if(n[e]=="}")return};for(;e<n.length;++e)if(n[e-1]!="\\"&&n[e]=="$"&&n[e+1]=="{")return t=e++,r(e),this.lastIndex=e+1,{index:t,0:n.slice(t,e+1)};return null}},sub:[{type:"kwd",match:/^\${|}$/g},{match:/(?!^\$|{)[^]+(?=}$)/g,sub:"js"}]}],Ot="str"}),Pt={};d(Pt,{default:()=>Ee,type:()=>Dt});var Ee,Dt,jt=u(()=>{Ee=[{type:"err",match:/\b(TODO|FIXME|DEBUG|OPTIMIZE|WARNING|XXX|BUG)\b/g},{type:"class",match:/\bIDEA\b/g},{type:"insert",match:/\b(CHANGED|FIX|CHANGE)\b/g},{type:"oper",match:/\bQUESTION\b/g}],Dt="cmnt"}),zt={};d(zt,{default:()=>_t,type:()=>Bt});var _t,Bt,$r=u(()=>{jt(),_t=[{type:"kwd",match:/@\w+/g},{type:"class",match:/{[\w\s|<>,.@\[\]]+}/g},{type:"var",match:/\[[\w\s="']+\]/g},...Ee],Bt="cmnt"}),Mt={};d(Mt,{default:()=>Ut});var Ut,Or=u(()=>{Ut=[{type:"var",match:/(("|')((?!\2)[^\r\n\\]|\\[^])*\2|[a-zA-Z]\w*)(?=\s*:)/g},{expand:"str"},{expand:"num"},{type:"num",match:/\bnull\b/g},{type:"bool",match:/\b(true|false)\b/g}]}),Ft={};d(Ft,{default:()=>Te});var Te,Ht=u(()=>{we(),Te=[{type:"cmnt",match:/^>.*|(=|-)\1+/gm},{type:"class",match:/\*\*.*?\*\*/g},{match:/^(`{3,})(.*)\n[^]*?^\1[ \t]*$/gm,sub:n=>({type:"kwd",sub:[{match:/\n[^]*(?=```)/g,sub:n.split(`
`)[0].slice(3)||Y(n)}]})},{type:"str",match:/`[^`]*`/g},{type:"var",match:/~~.*?~~/g},{type:"kwd",match:/\b_\S([^\n]*?\S)?_\b|\*\S([^\n]*?\S)?\*/g},{type:"kwd",match:/^\s*(\*|\d+\.)\s/gm},{type:"func",match:/\[[^\]]*]\([^)]*\)|<[^>]*>/g,sub:[{type:"oper",match:/^\[[^\]]*]/g}]}]}),Gt={};d(Gt,{default:()=>qt});var qt,Pr=u(()=>{Ht(),we(),qt=[{type:"insert",match:/(leanpub-start-insert)((?!leanpub-end-insert)[^])*(leanpub-end-insert)?/g,sub:[{type:"insert",match:/leanpub-(start|end)-insert/g},{match:/(?!leanpub-start-insert)((?!leanpub-end-insert)[^])*/g,sub:Y}]},{type:"deleted",match:/(leanpub-start-delete)((?!leanpub-end-delete)[^])*(leanpub-end-delete)?/g,sub:[{type:"deleted",match:/leanpub-(start|end)-delete/g},{match:/(?!leanpub-start-delete)((?!leanpub-end-delete)[^])*/g,sub:Y}]},...Te]}),Zt={};d(Zt,{default:()=>Wt});var Wt,Dr=u(()=>{Wt=[{type:"cmnt",match:/^#.*/gm},{expand:"strDouble"},{expand:"num"},{type:"err",match:/\b(err(or)?|[a-z_-]*exception|warn|warning|failed|ko|invalid|not ?found|alert|fatal)\b/gi},{type:"num",match:/\b(null|undefined)\b/gi},{type:"bool",match:/\b(false|true|yes|no)\b/gi},{type:"oper",match:/\.|,/g}]}),Yt={};d(Yt,{default:()=>Xt});var Xt,jr=u(()=>{Xt=[{match:/^#!.*|--(\[(=*)\[[^]*?\]\2\]|.*)/g,sub:"todo"},{expand:"str"},{type:"kwd",match:/\b(and|break|do|else|elseif|end|for|function|if|in|local|not|or|repeat|return|then|until|while)\b/g},{type:"bool",match:/\b(true|false|nil)\b/g},{type:"oper",match:/[+*/%^#=~<>:,.-]+/g},{expand:"num"},{type:"func",match:/[a-z_]+(?=\s*[({])/g}]}),Qt={};d(Qt,{default:()=>Kt});var Kt,zr=u(()=>{Kt=[{match:/^\s*#.*/gm,sub:"todo"},{expand:"str"},{type:"oper",match:/[${}()]+/g},{type:"class",match:/.PHONY:/gm},{type:"section",match:/^[\w.]+:/gm},{type:"kwd",match:/\b(ifneq|endif)\b/g},{expand:"num"},{type:"var",match:/[A-Z_]+(?=\s*=)/g},{match:/^.*$/gm,sub:"bash"}]}),Vt={};d(Vt,{default:()=>Jt});var Jt,_r=u(()=>{Jt=[{match:/#.*/g,sub:"todo"},{type:"str",match:/(["'])(\\[^]|(?!\1)[^])*\1?/g},{expand:"num"},{type:"kwd",match:/\b(any|break|continue|default|delete|die|do|else|elsif|eval|for|foreach|given|goto|if|last|local|my|next|our|package|print|redo|require|return|say|state|sub|switch|undef|unless|until|use|when|while|not|and|or|xor)\b/g},{type:"oper",match:/[-+*/%~!&<>|=?,]+/g},{type:"func",match:/[a-z_]+(?=\s*\()/g}]}),en={};d(en,{default:()=>tn});var tn,Br=u(()=>{tn=[{expand:"strDouble"}]}),nn={};d(nn,{default:()=>rn});var rn,Mr=u(()=>{rn=[{match:/#.*/g,sub:"todo"},{type:"str",match:/f("""|''')(\\[^]|(?!\1)[^])*\1?|f("|')(\\[^]|(?!\3).)*\3?/gi,sub:[{type:"var",match:/{[^{}]*}/g,sub:[{match:/(?!^{)[^]*(?=}$)/g,sub:"py"}]}]},{match:/("""|''')(\\[^]|(?!\1)[^])*\1?/g,sub:"todo"},{expand:"str"},{type:"kwd",match:/\b(and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g},{type:"bool",match:/\b(False|True|None)\b/g},{expand:"num"},{type:"func",match:/[a-z_]\w*(?=\s*\()/gi},{type:"oper",match:/[-/*+<>,=!&|^%]+/g},{type:"class",match:/\b[A-Z][\w_]*\b/g}]}),sn={};d(sn,{default:()=>an,type:()=>ln});var an,ln,Ur=u(()=>{an=[{match:/^(?!\/).*/gm,sub:"todo"},{type:"num",match:/\[((?!\])[^\\]|\\.)*\]/g},{type:"kwd",match:/\||\^|\$|\\.|\w+($|\r|\n)/g},{type:"var",match:/\*|\+|\{\d+,\d+\}/g}],ln="oper"}),on={};d(on,{default:()=>cn});var cn,Fr=u(()=>{cn=[{match:/\/\/.*\n?|\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{type:"type",match:/'[a-z_]\w*(?!')/g},{expand:"str"},{expand:"num"},{type:"kwd",match:/\b(as|break|const|continue|crate|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while|async|await|dyn|abstract|become|box|do|final|macro|override|priv|typeof|unsized|virtual|yield|try)\b/g},{type:"oper",match:/[/*+:?&|%^~=!,<>.^-]+/g},{type:"class",match:/\b[A-Z][\w_]*\b/g},{type:"func",match:/[a-zA-Z_][\w_]*(?=\s*!?\s*\()/g}]}),pn={};d(pn,{default:()=>hn});var hn,Hr=u(()=>{hn=[{match:/--.*\n?|\/\*((?!\*\/)[^])*(\*\/)?/g,sub:"todo"},{expand:"str"},{type:"func",match:/\b(AVG|COUNT|FIRST|FORMAT|LAST|LCASE|LEN|MAX|MID|MIN|MOD|NOW|ROUND|SUM|UCASE)(?=\s*\()/gi},{type:"kwd",match:/\b(ACTION|ADD|AFTER|ALGORITHM|ALL|ALTER|ANALYZE|ANY|APPLY|AS|ASC|AUTHORIZATION|AUTO_INCREMENT|BACKUP|BDB|BEGIN|BERKELEYDB|BIGINT|BINARY|BIT|BLOB|BOOL|BOOLEAN|BREAK|BROWSE|BTREE|BULK|BY|CALL|CASCADED?|CASE|CHAIN|CHAR(?:ACTER|SET)?|CHECK(?:POINT)?|CLOSE|CLUSTERED|COALESCE|COLLATE|COLUMNS?|COMMENT|COMMIT(?:TED)?|COMPUTE|CONNECT|CONSISTENT|CONSTRAINT|CONTAINS(?:TABLE)?|CONTINUE|CONVERT|CREATE|CROSS|CURRENT(?:_DATE|_TIME|_TIMESTAMP|_USER)?|CURSOR|CYCLE|DATA(?:BASES?)?|DATE(?:TIME)?|DAY|DBCC|DEALLOCATE|DEC|DECIMAL|DECLARE|DEFAULT|DEFINER|DELAYED|DELETE|DELIMITERS?|DENY|DESC|DESCRIBE|DETERMINISTIC|DISABLE|DISCARD|DISK|DISTINCT|DISTINCTROW|DISTRIBUTED|DO|DOUBLE|DROP|DUMMY|DUMP(?:FILE)?|DUPLICATE|ELSE(?:IF)?|ENABLE|ENCLOSED|END|ENGINE|ENUM|ERRLVL|ERRORS|ESCAPED?|EXCEPT|EXEC(?:UTE)?|EXISTS|EXIT|EXPLAIN|EXTENDED|FETCH|FIELDS|FILE|FILLFACTOR|FIRST|FIXED|FLOAT|FOLLOWING|FOR(?: EACH ROW)?|FORCE|FOREIGN|FREETEXT(?:TABLE)?|FROM|FULL|FUNCTION|GEOMETRY(?:COLLECTION)?|GLOBAL|GOTO|GRANT|GROUP|HANDLER|HASH|HAVING|HOLDLOCK|HOUR|IDENTITY(?:_INSERT|COL)?|IF|IGNORE|IMPORT|INDEX|INFILE|INNER|INNODB|INOUT|INSERT|INT|INTEGER|INTERSECT|INTERVAL|INTO|INVOKER|ISOLATION|ITERATE|JOIN|KEYS?|KILL|LANGUAGE|LAST|LEAVE|LEFT|LEVEL|LIMIT|LINENO|LINES|LINESTRING|LOAD|LOCAL|LOCK|LONG(?:BLOB|TEXT)|LOOP|MATCH(?:ED)?|MEDIUM(?:BLOB|INT|TEXT)|MERGE|MIDDLEINT|MINUTE|MODE|MODIFIES|MODIFY|MONTH|MULTI(?:LINESTRING|POINT|POLYGON)|NATIONAL|NATURAL|NCHAR|NEXT|NO|NONCLUSTERED|NULLIF|NUMERIC|OFF?|OFFSETS?|ON|OPEN(?:DATASOURCE|QUERY|ROWSET)?|OPTIMIZE|OPTION(?:ALLY)?|ORDER|OUT(?:ER|FILE)?|OVER|PARTIAL|PARTITION|PERCENT|PIVOT|PLAN|POINT|POLYGON|PRECEDING|PRECISION|PREPARE|PREV|PRIMARY|PRINT|PRIVILEGES|PROC(?:EDURE)?|PUBLIC|PURGE|QUICK|RAISERROR|READS?|REAL|RECONFIGURE|REFERENCES|RELEASE|RENAME|REPEAT(?:ABLE)?|REPLACE|REPLICATION|REQUIRE|RESIGNAL|RESTORE|RESTRICT|RETURN(?:S|ING)?|REVOKE|RIGHT|ROLLBACK|ROUTINE|ROW(?:COUNT|GUIDCOL|S)?|RTREE|RULE|SAVE(?:POINT)?|SCHEMA|SECOND|SELECT|SERIAL(?:IZABLE)?|SESSION(?:_USER)?|SET(?:USER)?|SHARE|SHOW|SHUTDOWN|SIMPLE|SMALLINT|SNAPSHOT|SOME|SONAME|SQL|START(?:ING)?|STATISTICS|STATUS|STRIPED|SYSTEM_USER|TABLES?|TABLESPACE|TEMP(?:ORARY|TABLE)?|TERMINATED|TEXT(?:SIZE)?|THEN|TIME(?:STAMP)?|TINY(?:BLOB|INT|TEXT)|TOP?|TRAN(?:SACTIONS?)?|TRIGGER|TRUNCATE|TSEQUAL|TYPES?|UNBOUNDED|UNCOMMITTED|UNDEFINED|UNION|UNIQUE|UNLOCK|UNPIVOT|UNSIGNED|UPDATE(?:TEXT)?|USAGE|USE|USER|USING|VALUES?|VAR(?:BINARY|CHAR|CHARACTER|YING)|VIEW|WAITFOR|WARNINGS|WHEN|WHERE|WHILE|WITH(?: ROLLUP|IN)?|WORK|WRITE(?:TEXT)?|YEAR)\b/gi},{type:"num",match:/\.?\d[\d.oxa-fA-F-]*|\bNULL\b/gi},{type:"bool",match:/\b(TRUE|FALSE)\b/gi},{type:"oper",match:/[-+*\/=%^~]|&&?|\|\|?|!=?|<(?:=>?|<|>)?|>[>=]?|\b(?:AND|BETWEEN|DIV|IN|ILIKE|IS|LIKE|NOT|OR|REGEXP|RLIKE|SOUNDS LIKE|XOR)\b/gi},{type:"var",match:/@\S+/g}]}),un={};d(un,{default:()=>dn});var dn,Gr=u(()=>{dn=[{match:/#.*/g,sub:"todo"},{type:"str",match:/("""|''')((?!\1)[^]|\\[^])*\1?/g},{expand:"str"},{type:"section",match:/^\[.+\]\s*$/gm},{type:"num",match:/\b(inf|nan)\b|\d[\d:ZT.-]*/g},{expand:"num"},{type:"bool",match:/\b(true|false)\b/g},{type:"oper",match:/[+,.=-]/g},{type:"var",match:/[\w-]+(?=\s*=)/g}]}),gn={};d(gn,{default:()=>mn});var mn,qr=u(()=>{Nt(),mn=[{type:"type",match:/:\s*(any|void|number|boolean|string|object|never|enum)\b/g},{type:"kwd",match:/\b(type|namespace|typedef|interface|public|private|protected|implements|declare|abstract|readonly)\b/g},...ve]}),fn={};d(fn,{default:()=>bn});var bn,Zr=u(()=>{bn=[{match:/^#.*/gm,sub:"todo"},{type:"class",match:/^\w+(?=:)/gm},{type:"num",match:/:\d+/g},{type:"oper",match:/[:/&?]|\w+=/g},{type:"func",match:/[.\w]+@|#[\w]+$/gm},{type:"var",match:/\w+\.\w+(\.\w+)*/g}]}),xn={};d(xn,{default:()=>kn});var kn,Wr=u(()=>{kn=[{match:/#.*/g,sub:"todo"},{expand:"str"},{type:"str",match:/(>|\|)\r?\n((\s[^\n]*)?(\r?\n|$))*/g},{type:"type",match:/!![a-z]+/g},{type:"bool",match:/\b(Yes|No)\b/g},{type:"oper",match:/[+:-]/g},{expand:"num"},{type:"var",match:/[a-zA-Z][\w-]*(?=:)/g}]}),Yr={num:{type:"num",match:/(\.e?|\b)\d(e-|[\d.oxa-fA-F_])*(\.|\b)/g},str:{type:"str",match:/(["'])(\\[^]|(?!\1)[^\r\n\\])*\1?/g},strDouble:{type:"str",match:/"((?!")[^\r\n\\]|\\[^])*"?/g}},Xr=xr({"./languages/asm.js":()=>Promise.resolve().then(()=>(kr(),Ke)),"./languages/bash.js":()=>Promise.resolve().then(()=>(et(),Je)),"./languages/bf.js":()=>Promise.resolve().then(()=>(yr(),tt)),"./languages/c.js":()=>Promise.resolve().then(()=>(wr(),rt)),"./languages/css.js":()=>Promise.resolve().then(()=>(vr(),at)),"./languages/csv.js":()=>Promise.resolve().then(()=>(Er(),lt)),"./languages/diff.js":()=>Promise.resolve().then(()=>(pt(),ct)),"./languages/docker.js":()=>Promise.resolve().then(()=>(Tr(),ht)),"./languages/git.js":()=>Promise.resolve().then(()=>(Rr(),dt)),"./languages/go.js":()=>Promise.resolve().then(()=>(Sr(),mt)),"./languages/html.js":()=>Promise.resolve().then(()=>(Ar(),yt)),"./languages/http.js":()=>Promise.resolve().then(()=>(Ir(),Et)),"./languages/ini.js":()=>Promise.resolve().then(()=>(Lr(),Rt)),"./languages/java.js":()=>Promise.resolve().then(()=>(Nr(),At)),"./languages/js.js":()=>Promise.resolve().then(()=>(Nt(),Lt)),"./languages/js_template_literals.js":()=>Promise.resolve().then(()=>(Cr(),Ct)),"./languages/jsdoc.js":()=>Promise.resolve().then(()=>($r(),zt)),"./languages/json.js":()=>Promise.resolve().then(()=>(Or(),Mt)),"./languages/leanpub-md.js":()=>Promise.resolve().then(()=>(Pr(),Gt)),"./languages/log.js":()=>Promise.resolve().then(()=>(Dr(),Zt)),"./languages/lua.js":()=>Promise.resolve().then(()=>(jr(),Yt)),"./languages/make.js":()=>Promise.resolve().then(()=>(zr(),Qt)),"./languages/md.js":()=>Promise.resolve().then(()=>(Ht(),Ft)),"./languages/pl.js":()=>Promise.resolve().then(()=>(_r(),Vt)),"./languages/plain.js":()=>Promise.resolve().then(()=>(Br(),en)),"./languages/py.js":()=>Promise.resolve().then(()=>(Mr(),nn)),"./languages/regex.js":()=>Promise.resolve().then(()=>(Ur(),sn)),"./languages/rs.js":()=>Promise.resolve().then(()=>(Fr(),on)),"./languages/sql.js":()=>Promise.resolve().then(()=>(Hr(),pn)),"./languages/todo.js":()=>Promise.resolve().then(()=>(jt(),Pt)),"./languages/toml.js":()=>Promise.resolve().then(()=>(Gr(),un)),"./languages/ts.js":()=>Promise.resolve().then(()=>(qr(),gn)),"./languages/uri.js":()=>Promise.resolve().then(()=>(Zr(),fn)),"./languages/xml.js":()=>Promise.resolve().then(()=>(kt(),bt)),"./languages/yaml.js":()=>Promise.resolve().then(()=>(Wr(),xn))}),yn={},Qr=(n="")=>n.replaceAll("&","&#38;").replaceAll?.("<","&lt;").replaceAll?.(">","&gt;"),Kr=(n,e)=>e?`<span class="shj-syn-${e}">${n}</span>`:n;async function wn(n,e,t){try{let r,s,a={},i,l=[],c=0,o=typeof e=="string"?await(yn[e]??(yn[e]=Xr(`./languages/${e}.js`))):e,h=[...typeof e=="string"?o.default:e.sub];for(;c<n.length;){for(a.index=null,r=h.length;r-- >0;){if(s=h[r].expand?Yr[h[r].expand]:h[r],l[r]===void 0||l[r].match.index<c){if(s.match.lastIndex=c,i=s.match.exec(n),i===null){h.splice(r,1),l.splice(r,1);continue}l[r]={match:i,lastIndex:s.match.lastIndex}}l[r].match[0]&&(l[r].match.index<=a.index||a.index===null)&&(a={part:s,index:l[r].match.index,match:l[r].match[0],end:l[r].lastIndex})}if(a.index===null)break;t(n.slice(c,a.index),o.type),c=a.end,a.part.sub?await wn(a.match,typeof a.part.sub=="string"?a.part.sub:typeof a.part.sub=="function"?a.part.sub(a.match):a.part,t):t(a.match,a.part.type)}t(n.slice(c,n.length),o.type)}catch{t(n)}}async function Vr(n,e,t=!0,r={}){let s="";return await wn(n,e,(a,i)=>s+=Kr(Qr(a),i)),t?`<div><div class="shj-numbers">${"<div></div>".repeat(!r.hideLineNumbers&&n.split(`
`).length)}</div><div>${s}</div></div>`:s}async function Jr(n,e=n.className.match(/shj-lang-([\w-]+)/)?.[1],t,r){let s=n.textContent;n.dataset.lang=e,n.className=`${[...n.classList].filter(a=>!a.startsWith("shj-")).join(" ")} shj-lang-${e} shj-${t}`,n.innerHTML=await Vr(s,e,t=="multiline",r)}const es="[class*=shj-lang-]{white-space:pre;color:#112;text-shadow:none;box-sizing:border-box;background:#fff;border-radius:10px;max-width:min(100%,100vw);margin:10px 0;padding:30px 20px;font:18px/24px Consolas,Courier New,Monaco,Andale Mono,Ubuntu Mono,monospace;box-shadow:0 0 5px #0001}.shj-inline{border-radius:5px;margin:0;padding:2px 5px;display:inline-block}[class*=shj-lang-]::selection{background:#bdf5}[class*=shj-lang-] ::selection{background:#bdf5}[class*=shj-lang-]>div{display:flex;overflow:auto}[class*=shj-lang-]>div :last-child{outline:none;flex:1}.shj-numbers{counter-reset:line;padding-left:5px}.shj-numbers div{padding-right:5px}.shj-numbers div:before{color:#999;content:counter(line);opacity:.5;text-align:right;counter-increment:line;margin-right:5px;display:block}.shj-syn-cmnt{font-style:italic}.shj-syn-err,.shj-syn-kwd{color:#e16}.shj-syn-num,.shj-syn-class{color:#f60}.shj-syn-insert,.shj-syn-str{color:#7d8}.shj-syn-bool{color:#3bf}.shj-syn-type,.shj-syn-oper{color:#5af}.shj-syn-section,.shj-syn-func{color:#84f}.shj-syn-deleted,.shj-syn-var{color:#f44}.shj-oneline{padding:12px 10px}.shj-lang-http.shj-oneline .shj-syn-kwd{color:#fff;background:#25f;border-radius:5px;padding:5px 7px}[class*=shj-lang-]{color:#24292f;background:#fff}.shj-syn-deleted,.shj-syn-err,.shj-syn-kwd{color:#cf222e}.shj-syn-class{color:#953800}.shj-numbers,.shj-syn-cmnt{color:#6e7781}.shj-syn-type,.shj-syn-oper,.shj-syn-num,.shj-syn-section,.shj-syn-var,.shj-syn-bool{color:#0550ae}.shj-syn-str{color:#0a3069}.shj-syn-func{color:#8250df}";function ts(n){return n.replace(/\/$/,"")}function ns(n){const e=n?.trim().toLowerCase();return e==="drawer"||e==="inline"?e:"floating"}function rs(n){const e=n?.trim()||"400px";return/^\d+$/.test(e)?`${e}px`:e}function ss(n,e){const t=n?.trim().toLowerCase();return t==="pill"?"pill":t==="hidden"||e?"hidden":"icon"}function as(n){const e=n.dataset,t=e.apiBaseUrl?.trim()||e.apiUrl?.trim()||"http://localhost:3010",r=e.exampleQuestions?.trim()??"",s=r?r.split("|").map(o=>o.trim()).filter(Boolean).slice(0,6):[],a=e.projectName?.trim()||"Ask AI",i=e.launcherSelector?.trim()||null,l=ns(e.mode),c=rs(e.drawerWidth);return{websiteId:e.websiteId?.trim()||"",apiBaseUrl:ts(t),projectName:a,projectColor:e.projectColor?.trim()||"#6b5a3e",projectLogo:e.projectLogo?.trim()||null,exampleQuestions:s,mode:l,mountSelector:e.mount?.trim()||null,launcherSelector:i,drawerWidth:c,launcherStyle:ss(e.launcher,!!i),launcherLabel:e.launcherLabel?.trim()||a}}function vn(n,e){const t=n.split(`

`),r=t.pop()??"";for(const s of t){const a=s.split(`
`).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart());if(a.length===0)continue;const i=a.join(`
`);if(!(!i||i==="[DONE]"))try{const l=JSON.parse(i);l&&typeof l=="object"&&"type"in l&&typeof l.type=="string"&&e(l)}catch{}}return r}async function is(n,e,t){const r=await fetch(`${n.apiBaseUrl}/api/widget/chat`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify({websiteId:n.websiteId,message:e})});if(!(r.headers.get("content-type")??"").includes("text/event-stream")){const p=await r.json().catch(()=>({})),T=typeof p.error=="string"?p.error:`Widget chat failed (${r.status})`;throw new Error(T)}if(!r.ok||!r.body)throw new Error(`Widget chat failed (${r.status})`);const a=r.body.getReader(),i=new TextDecoder;let l="",c="",o=[],h=!1,x=null;for(;;){const{done:p,value:T}=await a.read();if(p)break;l+=i.decode(T,{stream:!0}),l=vn(l,m=>{if(m.type==="token"&&m.text){c+=m.text,t.onToken(m.text);return}if(m.type==="done"){o=Array.isArray(m.citations)?m.citations:[],h=!!m.insufficient;return}m.type==="error"&&(x=m.error||"Stream failed")})}if(l.trim()&&vn(`${l}

`,p=>{p.type==="token"&&p.text?(c+=p.text,t.onToken(p.text)):p.type==="done"?(o=Array.isArray(p.citations)?p.citations:[],h=!!p.insufficient):p.type==="error"&&(x=p.error||"Stream failed")}),x)throw new Error(x);return{answer:c,citations:o,insufficient:h}}function A(n){return n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}const Re="ledgeindex-widget-drawer-layout";function En(n,e){if(typeof document>"u")return;if(!n){document.documentElement.classList.remove("li-widget-drawer-open"),document.getElementById(Re)?.remove();return}let t=document.getElementById(Re);t||(t=document.createElement("style"),t.id=Re,document.head.appendChild(t)),t.textContent=`
    html.li-widget-drawer-open {
      --li-drawer-width: ${e};
    }
    html.li-widget-drawer-open body {
      margin-right: var(--li-drawer-width) !important;
      transition: margin-right 0.25s ease;
    }
  `,document.documentElement.classList.add("li-widget-drawer-open")}function Tn(){En(!1,"0px")}const ls=`<svg class="li-launcher-icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;function os(n){const e=(n||"plain").toLowerCase().trim();return{javascript:"js",typescript:"ts",tsx:"ts",jsx:"js",python:"py",shell:"bash",sh:"bash",zsh:"bash",yml:"yaml",text:"plain",txt:"plain"}[e]??e}const Se=new f.Renderer;Se.code=({text:n,lang:e})=>{const t=os(e);return`<pre class="li-pre li-scroll"><code class="shj-lang-${A(t)}">${A(n)}</code></pre>`},Se.link=({href:n,title:e,text:t})=>{const r=n?A(n):"",s=e?` title="${A(e)}"`:"";return`<a href="${r}"${s} target="_blank" rel="noopener noreferrer">${t}</a>`},f.setOptions({renderer:Se,gfm:!0,breaks:!1});function cs(n){const e=n.projectColor?.trim()||"#6b5a3e",t=n.drawerWidth||"400px";return`
${es}
:host {
  all: initial;
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  color-scheme: light;
}
* { box-sizing: border-box; }
.li-root {
  --li-bg: #f6f2ea;
  --li-fg: #1c1917;
  --li-muted: #78716c;
  --li-muted-strong: #44403c;
  --li-border: rgb(214 204 190 / 0.9);
  --li-card: #fffcf7;
  --li-raised: #f0ebe3;
  --li-accent: ${e};
  --li-accent-soft: color-mix(in srgb, ${e} 12%, transparent);
  --li-shadow: 0 1px 2px rgb(15 23 42 / 0.04), 0 12px 40px rgb(28 25 23 / 0.1);
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
}

/* Thin scrollbar — light theme */
.li-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgb(180 168 152 / 0.9) transparent;
}
.li-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.li-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.li-scroll::-webkit-scrollbar-thumb {
  background: rgb(180 168 152 / 0.85);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.li-scroll::-webkit-scrollbar-thumb:hover {
  background: rgb(140 128 112 / 0.95);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.li-launcher {
  pointer-events: auto;
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--li-border);
  border-radius: 999px;
  background: var(--li-card);
  color: var(--li-fg);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--li-shadow);
}
.li-launcher:hover {
  background: #fff;
}
.li-launcher-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #b45309, #64748b);
}
.li-launcher-icon {
  width: 52px;
  height: 52px;
  padding: 0;
  justify-content: center;
  color: var(--li-fg);
}
.li-launcher-icon-svg {
  width: 22px;
  height: 22px;
  display: block;
}
.li-launcher-hidden {
  display: none !important;
}
.li-modal {
  pointer-events: auto;
  position: fixed;
  right: 20px;
  bottom: 76px;
  width: min(400px, calc(100vw - 24px));
  height: min(560px, calc(100vh - 110px));
  display: none;
  flex-direction: column;
  border: 1px solid var(--li-border);
  border-radius: 16px;
  background: var(--li-card);
  color: var(--li-fg);
  overflow: hidden;
  box-shadow: var(--li-shadow);
}
.li-modal[data-open="true"] {
  display: flex;
}
.li-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--li-border);
  background: var(--li-raised);
}
.li-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--li-accent);
  display: inline-block;
  border: 1px solid var(--li-border);
}
.li-title {
  flex: 1;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.li-header button {
  border: 0;
  background: transparent;
  color: var(--li-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.li-header button:hover {
  color: var(--li-fg);
}
.li-messages {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--li-bg);
}
.li-msg-user {
  align-self: flex-end;
  max-width: 85%;
  background: var(--li-raised);
  border: 1px solid var(--li-border);
  border-radius: 14px 14px 4px 14px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  color: var(--li-fg);
}
.li-msg-assistant {
  align-self: stretch;
  font-size: 13px;
  line-height: 1.55;
  color: var(--li-fg);
  background: var(--li-card);
  border: 1px solid var(--li-border);
  border-radius: 14px 14px 14px 4px;
  padding: 10px 12px;
}
.li-msg-assistant :first-child { margin-top: 0; }
.li-msg-assistant :last-child { margin-bottom: 0; }
.li-msg-assistant p, .li-msg-assistant ul, .li-msg-assistant ol, .li-msg-assistant pre, .li-msg-assistant table {
  margin: 0 0 0.75em;
}
.li-msg-assistant h1, .li-msg-assistant h2, .li-msg-assistant h3 {
  margin: 0.9em 0 0.4em;
  font-size: 1em;
  font-weight: 700;
  color: var(--li-muted-strong);
}
.li-msg-assistant a { color: var(--li-accent); }
.li-msg-assistant code:not([class*="shj-lang-"]) {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--li-raised);
  border: 1px solid var(--li-border);
  border-radius: 6px;
  padding: 0.1em 0.35em;
  color: var(--li-muted-strong);
}
.li-pre {
  margin: 0 0 0.75em;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--li-border);
  background: #fff;
  padding: 10px 12px;
}
.li-pre code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--li-fg);
}
.li-table-wrap { overflow: auto; margin-bottom: 0.75em; }
.li-msg-assistant table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.li-msg-assistant th, .li-msg-assistant td {
  border: 1px solid var(--li-border);
  padding: 6px 8px;
  text-align: left;
}
.li-msg-assistant th {
  background: var(--li-raised);
  color: var(--li-muted-strong);
}
.li-sources {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--li-border);
  font-size: 12px;
  color: var(--li-muted);
}
.li-sources a {
  color: var(--li-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.li-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.li-examples button {
  border: 1px solid var(--li-border);
  background: var(--li-card);
  color: var(--li-muted-strong);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
}
.li-examples button:hover {
  background: var(--li-raised);
  color: var(--li-fg);
}
.li-footer {
  border-top: 1px solid var(--li-border);
  padding: 10px;
  background: var(--li-raised);
}
.li-form {
  display: block;
}
.li-composer {
  border: 1px solid var(--li-border);
  border-radius: 16px;
  background: var(--li-card);
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.li-composer:focus-within {
  border-color: color-mix(in srgb, var(--li-accent) 45%, var(--li-border));
  box-shadow: 0 0 0 3px var(--li-accent-soft);
}
.li-composer textarea {
  display: block;
  width: 100%;
  resize: none;
  min-height: 56px;
  max-height: 120px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--li-fg);
  padding: 12px 14px 6px;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  outline: none;
  box-shadow: none;
}
.li-composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 10px 12px;
}
.li-powered {
  margin: 0;
  text-align: left;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--li-muted);
  white-space: nowrap;
}
.li-form button[type="submit"] {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: var(--li-accent);
  color: #fffcf7;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.li-form button[type="submit"]:hover {
  filter: brightness(1.05);
}
.li-thinking {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--li-muted);
  font-size: 13px;
  padding: 4px 2px;
}
.li-thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--li-accent);
  animation: li-pulse 1s ease-in-out infinite;
}
@keyframes li-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1); }
}
.li-form button:disabled { opacity: 0.5; cursor: not-allowed; }
.li-error { color: #b91c1c; font-size: 12px; margin-bottom: 6px; }

/* Drawer — full-height panel that pushes page layout from the right */
.li-mode-drawer .li-modal {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(${t}, 100vw);
  height: 100vh;
  max-height: none;
  border-radius: 0;
  border-right: 0;
  border-top: 0;
  border-bottom: 0;
  display: flex;
  transform: translateX(100%);
  transition: transform 0.25s ease;
}
.li-mode-drawer .li-modal[data-open="true"] {
  transform: translateX(0);
}

/* Inline — mount inside a host div */
.li-mode-inline {
  position: relative;
  inset: auto;
  pointer-events: auto;
  width: 100%;
  height: 100%;
  min-height: 420px;
  z-index: auto;
}
.li-mode-inline .li-launcher {
  display: none;
}
.li-mode-inline .li-modal {
  position: relative;
  inset: auto;
  right: auto;
  bottom: auto;
  width: 100%;
  height: 100%;
  min-height: 420px;
  max-height: none;
  display: flex;
  transform: none;
}
`}function ps(n){return n.length?`<div class="li-sources"><strong>Sources: </strong>${n.map((t,r)=>{const s=A(t.name||t.url||"source"),a=r>0?", ":"";return t.url?`${a}<a href="${A(t.url)}" target="_blank" rel="noopener noreferrer">${s}</a>`:`${a}${s}`}).join("")}</div>`:""}function Rn(n,e){const t=e==="action"?"data-action":"data-example";for(const r of n.composedPath())if(r instanceof HTMLElement&&r.hasAttribute(t))return r;return null}function hs(n){return n.launcherStyle==="hidden"?"":n.launcherStyle==="pill"?`<button type="button" class="li-launcher" data-action="toggle" aria-expanded="false">
          <span class="li-launcher-dot"></span>
          <span data-launcher-label>${A(n.projectName)}</span>
        </button>`:`<button type="button" class="li-launcher li-launcher-icon" data-action="toggle" aria-expanded="false" aria-label="${A(n.launcherLabel)}">
          ${ls}
        </button>`}class Sn extends HTMLElement{constructor(t){super();F(this,g);F(this,I);F(this,U,!1);F(this,D,!1);F(this,j,null);z(this,I,t),this.attachShadow({mode:"open"})}connectedCallback(){E(this,g,Oe).call(this),E(this,g,Pe).call(this)}disconnectedCallback(){R(this,j)?.abort(),z(this,j,null),R(this,I).mode==="drawer"&&Tn()}open(){E(this,g,_).call(this,!0)}close(){E(this,g,_).call(this,!1)}toggle(){E(this,g,_).call(this,!R(this,D))}}I=new WeakMap,U=new WeakMap,D=new WeakMap,j=new WeakMap,g=new WeakSet,Oe=function(){const t=this.shadowRoot;if(!t)return;const r=R(this,I),s=r.mode==="drawer"?"li-mode-drawer":r.mode==="inline"?"li-mode-inline":"li-mode-floating",a=r.projectLogo?`<img class="li-logo" src="${A(r.projectLogo)}" alt="" />`:"",i=r.exampleQuestions.length>0?`<div class="li-examples">${r.exampleQuestions.map(c=>`<button type="button" data-example="${A(c)}">${A(c)}</button>`).join("")}</div>`:"",l=r.mode==="inline";t.innerHTML=`
      <style>${cs(r)}</style>
      <div class="li-root ${s}">
        <div class="li-modal" data-open="${l?"true":"false"}" role="dialog" aria-hidden="${l?"false":"true"}">
          <div class="li-header">
            ${a}
            <div class="li-title">${A(r.projectName)}</div>
            <button type="button" data-action="new">+ New</button>
            <button type="button" data-action="close" aria-label="Close">✕</button>
          </div>
          <div class="li-messages li-scroll" id="messages">
            <div class="li-msg-assistant" data-welcome>
              <p>Ask anything about the docs.</p>
              ${i}
            </div>
          </div>
          <div class="li-footer">
            <div class="li-error" id="error" hidden></div>
            <form class="li-form" id="form">
              <div class="li-composer">
                <textarea id="input" rows="1" placeholder="Ask me a question about ${A(r.projectName)}…"></textarea>
                <div class="li-composer-bar">
                  <div class="li-powered">Powered by LedgeIndex</div>
                  <button type="submit" id="send" aria-label="Send">↑</button>
                </div>
              </div>
            </form>
          </div>
        </div>
        ${hs(r)}
      </div>
    `,z(this,D,l),E(this,g,De).call(this,R(this,D))},Pe=function(){const t=this.shadowRoot;if(!t)return;R(this,j)?.abort(),z(this,j,new AbortController);const{signal:r}=R(this,j);t.addEventListener("click",i=>{const l=Rn(i,"action");if(l){const o=l.dataset.action;o==="toggle"?E(this,g,_).call(this,!R(this,D)):o==="close"?E(this,g,_).call(this,!1):o==="new"&&E(this,g,On).call(this);return}const c=Rn(i,"example");c?.dataset.example&&E(this,g,ie).call(this,c.dataset.example)},{signal:r});const s=t.getElementById("form"),a=t.getElementById("input");s?.addEventListener("submit",i=>{i.preventDefault(),E(this,g,ie).call(this,a?.value??"")},{signal:r}),a?.addEventListener("keydown",i=>{i.key==="Enter"&&!i.shiftKey&&(i.preventDefault(),E(this,g,ie).call(this,a.value))},{signal:r})},_=function(t){z(this,D,t),E(this,g,De).call(this,t)},De=function(t){const r=this.shadowRoot;if(!r)return;const s=r.querySelector(".li-modal"),a=r.querySelector("[data-launcher-label]"),i=r.querySelector(".li-launcher");s&&(s.setAttribute("data-open",t?"true":"false"),s.setAttribute("aria-hidden",t?"false":"true"),i?.setAttribute("aria-expanded",t?"true":"false"),a&&(a.textContent=t?"Close":R(this,I).projectName),R(this,I).mode==="drawer"&&En(t,R(this,I).drawerWidth),R(this,I).launcherSelector&&document.querySelectorAll(R(this,I).launcherSelector).forEach(l=>{l.setAttribute("aria-pressed",t?"true":"false")}))},On=function(){z(this,U,!1),E(this,g,Oe).call(this),E(this,g,Pe).call(this),E(this,g,_).call(this,!0)},se=function(t){const r=this.shadowRoot?.getElementById("error");if(r){if(!t){r.hidden=!0,r.textContent="";return}r.hidden=!1,r.textContent=t}},ae=function(t){z(this,U,t);const r=this.shadowRoot?.getElementById("send"),s=this.shadowRoot?.getElementById("input");r&&(r.disabled=t),s&&(s.disabled=t)},ie=async function(t){const r=t.trim();if(!r||R(this,U))return;if(!R(this,I).websiteId){E(this,g,se).call(this,"Missing data-website-id on the widget script.");return}E(this,g,_).call(this,!0),E(this,g,se).call(this,null),E(this,g,ae).call(this,!0);const s=this.shadowRoot?.getElementById("messages"),a=this.shadowRoot?.getElementById("input");if(!s){E(this,g,ae).call(this,!1);return}s.querySelector("[data-welcome]")?.remove(),a&&(a.value="");const i=document.createElement("div");i.className="li-msg-user",i.textContent=r,s.appendChild(i);const l=document.createElement("div");l.className="li-thinking",l.dataset.thinking="1",l.setAttribute("aria-live","polite"),l.innerHTML='<span class="li-thinking-dot" aria-hidden="true"></span><span>Thinking…</span>',s.appendChild(l),s.scrollTop=s.scrollHeight;const c=document.createElement("div");c.className="li-msg-assistant",c.hidden=!0,s.appendChild(c);let o="",h=!1;const x=()=>{h||(h=!0,requestAnimationFrame(()=>{h=!1,c.innerHTML=f.parse(o,{async:!1}),s.scrollTop=s.scrollHeight}))};try{const p=await is(R(this,I),r,{onToken:T=>{l.isConnected&&l.remove(),c.hidden&&(c.hidden=!1),o+=T,x()}});l.remove(),c.hidden&&(c.hidden=!1),o=p.answer||o||"No answer returned.",await E(this,g,Pn).call(this,c,o,p.citations)}catch(p){l.remove(),c.remove(),E(this,g,se).call(this,p instanceof Error?p.message:"Request failed")}finally{E(this,g,ae).call(this,!1),s.scrollTop=s.scrollHeight}},Pn=async function(t,r,s){t.innerHTML=f.parse(r,{async:!1}),t.querySelectorAll("table").forEach(i=>{const l=document.createElement("div");l.className="li-table-wrap li-scroll",i.replaceWith(l),l.appendChild(i)}),t.insertAdjacentHTML("beforeend",ps(s));const a=t.querySelectorAll("code[class*='shj-lang-']");for(const i of a)try{await Jr(i,void 0,"multiline",{hideLineNumbers:!0})}catch{}};function us(n,e){const t=r=>{const s=r.target;s instanceof Element&&s.closest(n)&&(r.preventDefault(),r.stopPropagation(),e())};return document.addEventListener("click",t,!0),()=>{document.removeEventListener("click",t,!0)}}function ds(n,e){return us(n,e)}function re(n){document.querySelector("ledgeindex-chat-widget")?.remove(),customElements.get("ledgeindex-chat-widget")||customElements.define("ledgeindex-chat-widget",Sn);const t=new Sn(n),r=n.mode==="inline"&&n.mountSelector?document.querySelector(n.mountSelector):null;n.mode==="inline"&&n.mountSelector&&!r&&console.warn(`[LedgeIndex widget] mount target not found: ${n.mountSelector}`),(r??document.body).appendChild(t);let s;return n.launcherSelector&&(s=ds(n.launcherSelector,()=>t.toggle())),{element:t,open:()=>t.open(),close:()=>t.close(),toggle:()=>t.toggle(),unmount:()=>{s?.(),Tn(),t.remove()}}}const An=document.currentScript??document.querySelector("script[data-website-id][src*='ledgeindex-widget']");function gs(n){window.LedgeIndexWidget={mount:re,open:()=>n.open(),close:()=>n.close(),toggle:()=>n.toggle(),unmount:()=>n.unmount()}}if(An){const n=()=>gs(re(as(An)));document.readyState==="loading"?document.addEventListener("DOMContentLoaded",n,{once:!0}):n()}else window.LedgeIndexWidget={mount:re};return k.mountWidget=re,Object.defineProperty(k,Symbol.toStringTag,{value:"Module"}),k})({});
//# sourceMappingURL=ledgeindex-widget.bundle.js.map
