exports.createStripeCheckoutSession = async function (data, context, functions, stripe) {
    
    if (data == null || data.user == null || data.user.name == null ||
        data.user.email == null || data.user.uid == null || data.user.partnerUid == null) {
        throw new functions.https.HttpsError('invalid-argument', 'A user object with uid, name, email and partnerUid is required');
    }

    try {
        const user = data.user;
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.name,
            metadata: {
                app_user_uid: user.uid,
                app_partner_uid: user.partnerUid
            }
        });

        const sku = await stripe.skus.retrieve('sku_G9eu1VDO87OV9b');

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                name: sku.attributes.name,
                images: [sku.image],
                amount: sku.price,
                currency: sku.currency,
                quantity: 1,
            }],
            customer: customer.id,
            client_reference_id: user.uid,
            // TODO: change urls when publish
            success_url: 'http://localhost:3000/purchase_success',
            cancel_url: 'http://localhost:3000',
        });

        return { sessionId: session.id };

    } catch (e) {
        console.log(e);
        throw new functions.https.HttpsError('internal', "ERROR_INTERNAL");
    }
}

exports.onStripeCheckoutCompletedHandler = function (request, response, stripe, endpointSecret, database) {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (e) {
        return response.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        //Fullfill the purchase...
        makeUserPremium();
    }

    response.json({ received: true });
}

function makeUserPremium(uid) {
    console.log("maker user premium called");
    // TODO: set user and partner to premium in db
}