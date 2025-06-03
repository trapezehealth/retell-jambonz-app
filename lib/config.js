// lib/config.js
const TRANSFER_LOOKUP_MAP = {
    "patient care coordinator team": { 
        type: "sip", 
        destination: "sip:9502@smdcc.fusionnetworks.net" 
    },
    "manhasset office front desk": { 
        type: "sip", 
        destination: "sip:9553@smdcc.fusionnetworks.net" // needs to ring or manage waiting to connect
    },
    "lasik evaluation team": { 
        type: "sip", 
        destination: "sip:9542@smdcc.fusionnetworks.net" 
    },
    "millenia team": { 
        type: "phone", 
        destination: "+18773530295" 
    },
    "billing team": { 
        type: "phone", 
        destination: "+18773530295" 
    },
    "clinical care team": { 
        type: "sip", 
        destination: "sip:9513@smdcc.fusionnetworks.net"  // this auto falls back it seems? seems OK
    },
    "manhasset surgery coordinator": { 
        type: "sip", 
        destination: "sip:1958@smdcc.fusionnetworks.net" // needs to ring or manage waiting to connect
    },
    "manhasset clinic manager": { 
        type: "sip", 
        destination: "sip:1952@smdcc.fusionnetworks.net" // needs update extension
    },
    "manhasset technician team": { 
        type: "sip", 
        destination: "sip:1951@smdcc.fusionnetworks.net" // needs to ring or manage waiting to connect
    },
    "manhasset medical records": { 
        type: "sip", 
        destination: "sip:1950@smdcc.fusionnetworks.net" // needs to ring or manage waiting to connect
    },
    "korean queue": { 
        type: "sip", 
        destination: "sip:9519@smdcc.fusionnetworks.net" 
    },
    "spanish queue": { 
        type: "sip", 
        destination: "sip:9506@smdcc.fusionnetworks.net" 
    }
};


module.exports = {
    TRANSFER_LOOKUP_MAP
};